# Status

**Active packet:** P-2 - Transactional hierarchical USD reservations
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

## Council verdicts (P-2)

| Role | Verdict | Evidence |
|---|---|---|
| Architect | PASS | Independent council re-review after deterministic lock-order correction. |
| Coder | PASS | Independent council reviewed SQLite isolation correction. |
| QA | PASS | Twelve passing tests, including both reproduced council defects. |
| UX | PASS | Explicit hold/settlement results; library has no visual surface. |
| Security | PASS | Security specialist found no high-confidence vulnerabilities in library scope. |

## Evidence

Initial Ironclad no-run gate passed with warnings for empty commands and scaffold unknowns.
Reference repository read through GitHub API only; no reference writes.
RED: `ERR_MODULE_NOT_FOUND` for `src/policy.js` before implementation.
GREEN: five tests pass, strict typecheck and build pass.
P-1 committed as `a42733b`; packet gate: 26 pass, zero warnings.
P-2 must prove concurrent caps, idempotent settlement, cache charging, missing
usage retention, calendar isolation and policy compare-and-swap.
RED: missing database module. Council RED: locale lock ordering mismatch and
same-connection SQLite read observed 10 before rollback instead of 0.
GREEN: twelve tests and strict types pass after both fixes.
PostgreSQL multi-replica validation remains a separately disclosed gap.
