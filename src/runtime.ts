import { z } from 'zod';
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';
import { GatewayError } from './errors.js';

export function parseEnvironment(env: NodeJS.ProcessEnv) {
  const parsed = z.object({
    TENANT_ID: z.string().uuid(),
    DEVELOPMENT_SUBSCRIPTION_ID: z.string().uuid().optional(),
    TOKEN_AUDIENCE: z.string().min(1),
    REQUIRED_SCOPE: z.string().default('Gateway.Invoke'),
    UPSTREAM_MODE: z.enum(['native', 'foundry']),
    UPSTREAM_BASE_URL: z.url(),
    DATABASE_URL: z.string().startsWith('postgresql://').optional(),
    LOCAL_SQLITE_PATH: z.string().optional(),
    GRAPH_CACHE_SECONDS: z.coerce.number().int().min(0).max(60).default(0),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    POLICY_FILE: z.string().optional()
  }).safeParse(env);
  if (!parsed.success) throw new Error('Invalid gateway configuration; check environment variable names and formats');
  const value = parsed.data;
  const url = new URL(value.UPSTREAM_BASE_URL);
  const suffix = value.UPSTREAM_MODE === 'native' ? '.azure-api.net' : '.services.ai.azure.com';
  if (url.protocol !== 'https:' || !url.hostname.endsWith(suffix) ||
      url.username || url.password || url.search || url.hash ||
      (!value.DATABASE_URL && (env.NODE_ENV === 'production' || !value.LOCAL_SQLITE_PATH))) {
    throw new Error('Invalid gateway configuration: require approved HTTPS upstream and PostgreSQL in production');
  }
  return {
    tenantId: value.TENANT_ID, developmentSubscriptionId: value.DEVELOPMENT_SUBSCRIPTION_ID,
    audience: value.TOKEN_AUDIENCE, requiredScope: value.REQUIRED_SCOPE,
    mode: value.UPSTREAM_MODE, baseUrl: value.UPSTREAM_BASE_URL.replace(/\/$/, ''),
    databaseUrl: value.DATABASE_URL, sqlitePath: value.LOCAL_SQLITE_PATH,
    graphCacheSeconds: value.GRAPH_CACHE_SECONDS, port: value.PORT, policyFile: value.POLICY_FILE
  };
}

export function createCredential(
  config: { tenantId: string; developmentSubscriptionId?: string },
  env: NodeJS.ProcessEnv = process.env
) {
  return env.NODE_ENV === 'production' ?
    new ManagedIdentityCredential(env.AZURE_CLIENT_ID ? { clientId: env.AZURE_CLIENT_ID } : {}) :
    new AzureCliCredential({
      ...(config.developmentSubscriptionId ? { subscription: config.developmentSubscriptionId } : { tenantId: config.tenantId }),
      processTimeoutInMs: 15000
    });
}

export function createUpstream(options: {
  mode: 'native' | 'foundry'; baseUrl: string;
  token: () => Promise<string>; fetch?: typeof fetch
}) {
  return async (body: Record<string, unknown>, signal: AbortSignal) => {
    try {
      return await (options.fetch ?? fetch)(`${options.baseUrl}/v1/messages`, {
        method: 'POST', redirect: 'error', signal,
        headers: {
          authorization: `Bearer ${await options.token()}`,
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });
    } catch { throw new GatewayError(502, 'upstream_unavailable'); }
  };
}
