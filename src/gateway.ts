import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import Fastify, { LogController, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { messageSchema, UsageTracker } from './anthropic.js';
import { GatewayError } from './errors.js';
import { Ledger, type Scope } from './ledger.js';
import { parseUsage, priceUsage, reserveCeiling, budgetMicros } from './money.js';
import { parsePolicy, resolveEntitlement, entitlementLimits, type Policy, type Entitlement, type Model } from './policy.js';

export type Identity = { oid: string; tid: string; applicationId: string; admin: boolean };
export type Dependencies = {
  ledger: Ledger;
  authenticate: (authorization: string | undefined) => Promise<Identity>;
  memberships: (identity: Identity) => Promise<string[]>;
  upstream: (body: Record<string, unknown>, signal: AbortSignal) => Promise<Response>;
  now?: () => Date;
  logging?: boolean;
};

function authorization(request: FastifyRequest): string | undefined {
  const bearer = request.headers.authorization;
  const key = request.headers['x-api-key'];
  if (key === undefined) return bearer;
  if (typeof key !== 'string' || (bearer !== undefined && bearer !== `Bearer ${key}`)) {
    throw new GatewayError(401, 'ambiguous_credentials');
  }
  return `Bearer ${key}`;
}

function budgetScopes(policy: Policy, who: Identity, entitlement: Entitlement, now: Date): Scope[] {
  const month = now.toISOString().slice(0, 7);
  const person = createHash('sha256').update(`${who.tid}:${who.oid}`).digest('hex');
  const limits = entitlementLimits(policy, entitlement);
  return [
    { key: `org:${month}`, limit: budgetMicros(policy.monthlyBudgetUsd) },
    { key: `bu:${entitlement.bu}:${month}`, limit: budgetMicros(policy.businessUnits[entitlement.bu]!.monthlyBudgetUsd) },
    { key: `tier:${entitlement.bu}:${entitlement.tier}:${month}`, limit: budgetMicros(limits.monthlyBudgetUsd) },
    { key: `user:${person}:${month}`, limit: budgetMicros(limits.userMonthlyBudgetUsd) }
  ];
}

function measuredCharge(model: Model, maxOutput: number, value: unknown): number | undefined {
  try {
    const usage = parseUsage(value);
    if (usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens > model.contextTokens ||
        usage.output_tokens > maxOutput) return undefined;
    return priceUsage(model, usage);
  } catch (error) {
    if (error instanceof GatewayError && error.code === 'usage_unavailable') return undefined;
    throw error;
  }
}

export function buildGateway(deps: Dependencies) {
  const app = Fastify({
    bodyLimit: 1_048_576, requestTimeout: 120000, genReqId: () => randomUUID(),
    logger: deps.logging ? { level: 'info', redact: ['req.headers.authorization'] } : false,
    logController: new LogController({ disableRequestLogging: true })
  });
  app.setErrorHandler((error, request, reply) => {
    const errorStatus = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = error instanceof GatewayError ? error.status :
      error instanceof ZodError ? 400 :
      typeof errorStatus === 'number' && errorStatus < 500 ? errorStatus : 502;
    const code = error instanceof GatewayError ? error.code : status < 500 ? 'invalid_request' : 'gateway_unavailable';
    const fields = error instanceof ZodError ? error.issues.map((issue) =>
      issue.code === 'unrecognized_keys' ? `${issue.path.join('.') || 'request'}: unknown fields ${issue.keys.join(',')}` :
        `${issue.path.join('.') || 'request'}: ${issue.code}`).join('; ') : undefined;
    request.log.error({ event: code, requestId: request.id, errorType: error instanceof Error ? error.name : 'Unknown' }, 'Gateway request failed');
    reply.code(status).send({ type: 'error', error: { type: code, message: fields ? `Invalid request fields: ${fields}` : code }, request_id: request.id });
  });
  const authenticate = (authorization: string | undefined) => deps.authenticate(authorization);
  const requireAdmin = async (authorization: string | undefined) => {
    const who = await authenticate(authorization);
    if (!who.admin) throw new GatewayError(403, 'admin_required');
  };
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => { await deps.ledger.getPolicy(); return { status: 'ready' }; });
  app.get('/admin/policy', async (request, reply) => {
    await requireAdmin(authorization(request));
    const result = await deps.ledger.getPolicy();
    reply.header('etag', String(result.version));
    return result;
  });
  app.put('/admin/policy', async (request) => {
    await requireAdmin(authorization(request));
    const expected = request.headers['if-match'];
    if (typeof expected !== 'string' || !/^\d{1,9}$/.test(expected)) throw new GatewayError(428, 'policy_version_required');
    const version = await deps.ledger.putPolicy(parsePolicy(request.body), Number(expected));
    return { version };
  });
  app.get('/admin/usage', async (request) => {
    await requireAdmin(authorization(request));
    return deps.ledger.report();
  });
  app.get('/v1/models', async (request) => {
    const who = await authenticate(authorization(request));
    const groups = await deps.memberships(who);
    const { policy } = await deps.ledger.getPolicy();
    const data = Object.keys(policy.models).filter((model) => {
      try { resolveEntitlement(policy, groups, who.applicationId, model); return true; }
      catch (error) {
        if (error instanceof GatewayError && error.code === 'model_not_allowed') return false;
        throw error;
      }
    }).map((id) => ({ id, type: 'model', display_name: id }));
    return { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null };
  });
  app.post('/v1/messages', async (request, reply) => {
    const who = await authenticate(authorization(request));
    const body = messageSchema.parse(request.body);
    const { policy, version } = await deps.ledger.getPolicy();
    const groups = await deps.memberships(who);
    const entitlement = resolveEntitlement(policy, groups, who.applicationId, body.model);
    const model = policy.models[body.model]!;
    if (body.max_tokens > entitlementLimits(policy, entitlement).maxOutputTokens) throw new GatewayError(400, 'output_limit_exceeded');
    const ceiling = reserveCeiling(model, body.max_tokens);
    const scopes = budgetScopes(policy, who, entitlement, (deps.now ?? (() => new Date()))());
    await deps.ledger.reserve(request.id, scopes, ceiling, { ...entitlement, policyVersion: String(version) });
    reply.header('x-request-id', request.id).header('x-policy-version', version);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(110000)]);
    const response = await deps.upstream({ ...body, model: model.deployment }, signal);
    reply.code(response.status);
    const settle = async (usage: unknown) => {
      const charge = measuredCharge(model, body.max_tokens, usage);
      const settled = await deps.ledger.settle(request.id, charge);
      if (!settled) request.log.warn({ event: 'budget_hold_retained', requestId: request.id }, 'Usage unavailable or outside configured ceilings');
      return settled;
    };
    if (response.ok && body.stream && response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
      const tracker = new UsageTracker();
      const streamBody = response.body;
      async function* stream() {
        let complete = false;
        try {
          for await (const chunk of streamBody) {
            tracker.push(chunk);
            yield chunk;
          }
          complete = true;
        } finally {
          if (complete && !signal.aborted) await settle(tracker.result());
          else request.log.warn({ event: 'budget_hold_retained', requestId: request.id }, 'Stream interrupted');
        }
      }
      reply.header('content-type', 'text/event-stream').header('cache-control', 'no-store');
      return reply.send(Readable.from(stream()));
    }
    const text = await response.text();
    if (text.length > 20_000_000) throw new GatewayError(502, 'upstream_response_too_large');
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new GatewayError(502, 'upstream_invalid_response'); }
    const usage = value && typeof value === 'object' && 'usage' in value ? value.usage : undefined;
    const settled = response.ok ? await settle(usage) : false;
    reply.header('x-budget-status', settled ? 'settled' : 'held');
    return reply.header('content-type', 'application/json').send(value);
  });
  return app;
}
