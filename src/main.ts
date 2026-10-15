import { readFile } from 'node:fs/promises';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { PostgresDatabase, SqliteDatabase } from './database.js';
import { GatewayError } from './errors.js';
import { buildGateway } from './gateway.js';
import { createAuthenticator, GraphMemberships } from './identity.js';
import { Ledger } from './ledger.js';
import { parsePolicy } from './policy.js';
import { createUpstream, parseEnvironment } from './runtime.js';

const config = parseEnvironment(process.env);
const credential = process.env.NODE_ENV === 'production' ?
  new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID ? { clientId: process.env.AZURE_CLIENT_ID } : {}) :
  new DefaultAzureCredential();
const getToken = async (scope: string) => {
  const result = await credential.getToken(scope);
  if (!result?.token) throw new GatewayError(503, 'server_identity_unavailable');
  return result.token;
};
const db = config.databaseUrl ? new PostgresDatabase(config.databaseUrl) : new SqliteDatabase(config.sqlitePath!);
const ledger = new Ledger(db);
await ledger.initialize();
try {
  await ledger.getPolicy();
} catch (error) {
  if (!(error instanceof GatewayError) || error.code !== 'policy_not_configured' || !config.policyFile) throw error;
  const policy = parsePolicy(JSON.parse(await readFile(config.policyFile, 'utf8')));
  try { await ledger.putPolicy(policy, 0); }
  catch (conflict) {
    if (!(conflict instanceof GatewayError) || conflict.code !== 'policy_conflict') throw conflict;
  }
}
const graph = new GraphMemberships(() => getToken('https://graph.microsoft.com/.default'), { ttlSeconds: config.graphCacheSeconds });
const upstreamScope = config.mode === 'native' ? 'https://azure-api.net/aigateway/.default' : 'https://cognitiveservices.azure.com/.default';
const app = buildGateway({
  ledger,
  authenticate: createAuthenticator(config),
  memberships: (who) => graph.get(who),
  upstream: createUpstream({ mode: config.mode, baseUrl: config.baseUrl, token: () => getToken(upstreamScope) }),
  logging: true
});
const shutdown = async () => { await app.close(); await db.close(); };
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
await app.listen({ host: config.databaseUrl ? '0.0.0.0' : '127.0.0.1', port: config.port });
