# AIGateway - Claude on Foundry

Independent request-time governance for Claude, with arbitrary business units,
tiers, model and OAuth-client permissions, and transactional USD reservations.
No per-person APIM named values and no membership projection/sync jobs.

**Under construction:** see [status](docs/STATUS.md). No production-scale or live
native-gateway compatibility claim is made until the corresponding evidence exists.

## Development

Requires Node.js 24 or later.

```powershell
npm ci
npm test
npm run typecheck
npm run build
node .ironclad\gate.mjs --stage packet
```

## Design boundary

Entra verifies the caller; Graph supplies transitive membership; intersected BU
and tier allowlists determine access; the database reserves spend before inference.
SQLite is for local tests; PostgreSQL is the multi-replica store.
Native AI Gateway is an optional upstream, not the identity or ledger authority.
Direct Foundry is a separately selected mode, never a hidden fallback.

This is a new project, not a fork or modification of
[claude-code-foundry-gateway](https://github.com/naveenneog/claude-code-foundry-gateway).
Its good identity boundary informed this design; its operational constraints are
recorded in [ADR-0002](docs/adr/0002-request-time-governance.md).

Preview gateway pricing does not imply free Claude inference. Cost estimates use
operator-supplied token-price ceilings, not an Azure invoice or credits ledger.
