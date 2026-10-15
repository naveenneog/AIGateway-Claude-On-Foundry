# Status

**Active packet:** P-1 - Request-time arbitrary BU/tier policy
**State:** GATE
**Branch:** main

## Acceptance criteria

- Any number of BU and tier definitions, with no per-developer named values.
- Exactly one matching BU and tier; ambiguous membership denied.
- BU and tier model/client allowlists intersect; neither overrides a denial.
- Invalid prices, budgets, group mappings and unknown fields rejected.
- Policy records contain group configuration, not a projected user roster.

## Commands

`npm test`, `npm run typecheck`, `npm run build`,
`node .ironclad/gate.mjs --stage packet`.

## Council verdicts

| Role | Verdict | Evidence |
|---|---|---|
| Architect | PASS | Single pure policy module; ADR-0002 records ownership. |
| Coder | PASS | Strict types; explicit fail-closed resolution; no duplicated policy logic. |
| QA | PASS | Five tests cover allow, deny, ambiguity, invalid input and 201 BU/tier definitions. |
| UX | PASS | Predictable error codes, no fixed tier names or highest-privilege surprises. |
| Security | PASS | Pure policy only, no external credential handling; no caller BU/tier inputs. |

## Evidence

Initial Ironclad no-run gate passed with warnings for empty commands and scaffold unknowns.
Reference repository read through GitHub API only; no reference writes.
RED: `ERR_MODULE_NOT_FOUND` for `src/policy.js` before implementation.
GREEN: five tests pass, strict typecheck and build pass.
