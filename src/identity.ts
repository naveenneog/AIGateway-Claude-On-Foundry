import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { GatewayError } from './errors.js';
import type { Identity } from './gateway.js';

const uuid = z.string().uuid();
export function createAuthenticator(
  config: { tenantId: string; audience: string; requiredScope: string },
  keySet?: JWTVerifyGetKey
) {
  uuid.parse(config.tenantId);
  const keys = keySet ?? createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`),
    { timeoutDuration: 5000, cooldownDuration: 30000 }
  );
  return async (authorization: string | undefined): Promise<Identity> => {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 32768) {
      throw new GatewayError(401, 'invalid_token');
    }
    try {
      const { payload } = await jwtVerify(authorization.slice(7), keys, {
        algorithms: ['RS256'],
        audience: config.audience,
        issuer: [`https://login.microsoftonline.com/${config.tenantId}/v2.0`, `https://sts.windows.net/${config.tenantId}/`],
        requiredClaims: ['exp', 'iat', 'tid', 'oid'],
        clockTolerance: 5
      });
      const oid = uuid.safeParse(payload.oid);
      const applicationId = uuid.safeParse(payload.azp ?? payload.appid);
      if (payload.tid !== config.tenantId || !oid.success || !applicationId.success ||
          payload.idtyp === 'app' || typeof payload.scp !== 'string' ||
          !payload.scp.split(' ').includes(config.requiredScope)) {
        throw new GatewayError(401, 'invalid_token');
      }
      return {
        tid: config.tenantId,
        oid: oid.data,
        applicationId: applicationId.data,
        admin: Array.isArray(payload.roles) && payload.roles.includes('Gateway.Admin')
      };
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      if (error instanceof errors.JOSEError) throw new GatewayError(401, 'invalid_token');
      throw new GatewayError(503, 'identity_unavailable');
    }
  };
}

type GraphOptions = { ttlSeconds?: number; now?: () => number; fetch?: typeof fetch };
export class GraphMemberships {
  private readonly cache = new Map<string, { expires: number; groups: string[] }>();
  private readonly pending = new Map<string, Promise<string[]>>();
  constructor(private readonly token: () => Promise<string>, private readonly options: GraphOptions = {}) {
    if ((options.ttlSeconds ?? 0) < 0 || (options.ttlSeconds ?? 0) > 60) throw new Error('Graph TTL must be between 0 and 60 seconds');
  }
  async get(who: Identity): Promise<string[]> {
    const key = `${who.tid}:${who.oid}`;
    const now = (this.options.now ?? Date.now)();
    const cached = this.cache.get(key);
    if (cached && cached.expires > now) return cached.groups;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const request = this.load(who).then((groups) => {
      const ttl = this.options.ttlSeconds ?? 0;
      if (ttl > 0) {
        if (this.cache.size >= 50000) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: now + ttl * 1000, groups });
      }
      return groups;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
  private async load(who: Identity): Promise<string[]> {
    let token: string;
    try { token = await this.token(); }
    catch (error) {
      throw new GatewayError(503, 'directory_unavailable', {
        dependency: 'directory', phase: 'credential', causeType: error instanceof Error ? error.name : 'Unknown'
      });
    }
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(who.oid)}/getMemberObjects`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ securityEnabledOnly: true }),
          signal: AbortSignal.timeout(10000)
        }
      );
    } catch (error) {
      throw new GatewayError(503, 'directory_unavailable', {
        dependency: 'directory', phase: 'request', causeType: error instanceof Error ? error.name : 'Unknown'
      });
    }
    if (!response.ok) throw new GatewayError(503, 'directory_unavailable', {
      dependency: 'directory', phase: 'response', status: response.status
    });
    let value: unknown;
    try { value = await response.json(); } catch { throw new GatewayError(503, 'directory_invalid_response'); }
    const result = z.object({ value: z.array(z.string().min(1).max(200)).max(11000) }).safeParse(value);
    if (!result.success) throw new GatewayError(503, 'directory_invalid_response');
    return result.data.value;
  }
}
