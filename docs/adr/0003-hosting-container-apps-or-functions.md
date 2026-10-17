# ADR-0003: Host the governance service on Container Apps; Functions is a supported alternative

Status: accepted. Date: 2026-10-17.

## Context

The governance service is a stateless Fastify HTTP server. All policy and budget
state lives in PostgreSQL, so any HTTPS host with managed identity can enforce the
same budgets. Two low-idle-cost Azure hosts fit: Azure Container Apps
(consumption) and Azure Functions Flex Consumption. The host was not chosen by a
benchmark; this record states the actual reasons and the alternative.

## Decision

Default to **Azure Container Apps** with the supplied Dockerfile, because:

- The existing server and container run unchanged; no second entry point.
- Claude Code depends on long-lived SSE streaming, which works as plain HTTP.
- Ingress timeout is configurable above the service's 110-second upstream bound.
- Few replicas, each with a 10-connection pool, keep PostgreSQL connections bounded.

**Functions Flex Consumption is acceptable** where an organisation standardises
on Function Apps. It also offers scale to zero, always-ready instances, managed
identity and VNet integration. Porting requires:

1. A v4 HTTP-trigger entry point (or an adapter) around the same route logic.
2. HTTP response streaming enabled for Node.js, then a live SSE test.
3. Confirming the front-end HTTP response limit (historically about 230 s) for
   the chosen plan; the 110-second upstream bound must stay below it.
4. Capping maximum instances or adding a PostgreSQL connection pooler, because
   each instance opens its own pool.
5. Provisioning the storage account Functions requires.

## Consequences

Container Apps is the only documented and container-ready path today. The
Functions port has not been implemented or live-tested, and must not be
claimed until it passes the same JSON/SSE/denial/budget checks as the soak.
Budget correctness does not depend on the host choice.

## Sources

- https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan
- https://learn.microsoft.com/azure/azure-functions/functions-reference-node
- https://learn.microsoft.com/azure/azure-functions/functions-bindings-http-webhook-trigger
