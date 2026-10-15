# Native AI Gateway capability assessment

Sources checked 2026-10-15. Distinguish portal documentation, ARM acceptance and
actual inference. None alone proves the other two.

| Capability | Native preview evidence | Project response |
|---|---|---|
| USD limits | Live native 403 after a small cost allowance was exhausted | Keep as outer guardrail |
| Entra callers | Live Bearer-token native inference returned 200 | Use server identity for the upstream boundary |
| API-key callers | Live runtime key inference returned 200 | Do not distribute upstream keys to developers |
| Claims overrides | Portal documents per-identity amounts, authored-order matching; read-only in current portal | Not relied on for shared pools |
| Shared BU budget | Portal explicitly says matching claims do not combine callers' counters | Transactional shared database budgets |
| BU AND tier policy | No native intersection primitive established by current contract | Resolve exactly one of each from Graph |
| Model routing | Callable alias with exactly one backend model; live accepted | Publish alias, not just catalog entry |
| Claude format | `apiFormat: AnthropicMessages`, `/anthropic/v1/messages` | Preserve Messages and SSE |
| Cross-instance native precision | Preview operational control, not a financial atomic-reservation guarantee | Reserve before dispatch |
| Pricing | Portal says gateway preview free; related resources/model inference separate | No free-inference promise |

## Reference limitations and what changed

The reference's September 23 notes observed model routes returning 404 for more
than six hours. The current portal contract adds a separate
`service/workspaces/default/aliases` resource. We deployed that resource and the
canonical `AnthropicMessages` format, then obtained 200 through the native route.
This proves our current path works; it does not prove the historical root cause
or repair the reference project.

The reference's per-developer named values and projected/synchronized membership
are not carried forward. A person's entitlement is resolved from Entra/Graph,
not a copied roster. The service has no hard-coded developer count or tier names.

## Primary sources

- https://ai.gateway.azure.com/docs
  Public portal bundle `/assets/index-CjhCTla2.js`, retrieved 2026-10-15.
  September 24 and October 1 release notes; policy/alias request builders.
- https://learn.microsoft.com/azure/api-management/ai-gateway-overview
- https://learn.microsoft.com/azure/api-management/ai-gateway-govern-secure-assets
- https://learn.microsoft.com/azure/api-management/ai-gateway-manage-models-tools
- https://github.com/Azure-Samples/simple-foundry-hosted-agent-python-aigateway
- https://github.com/naveenneog/claude-code-foundry-gateway/blob/main/docs/AI-GATEWAY-TIER.md

The Learn governance page predates the newer portal USD/Entra behavior. We
explicitly reconciled this conflict in ADR-0002 rather than choosing silently.
