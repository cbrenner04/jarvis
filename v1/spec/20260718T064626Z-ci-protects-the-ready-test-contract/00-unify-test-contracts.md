# Unify scoped and aggregate test contracts

## Problem

- PR CI can pass file rosters or runner policies that differ from the unscoped `bun run ready` aggregate.

## Decisions

- Derive the aggregate roster from the six scoped agent/integration rosters; rules out separately discovering aggregate files.
- Run every selected file in an isolated subprocess with one shared 180-second per-file timeout; rules out parallel scoped batches and unbounded integration files.
- Stop on an ordinary failure; continue agent-mode timeout diagnostics before returning red, while integration mode stops on timeout; rules out changing established aggregate failure handling.
- Keep path scoping additive: `v1/**` and `v2/**` select their agent/integration pairs, `shared/**` selects all pairs, and `test/**` selects the shared pair; rules out treating shared or harness tests as one consumer surface.
- Select the aggregate for root tooling, unresolved bases, empty changed-path input, and unknown paths; rules out guessing a narrow affected surface.
- Skip test slices for docs/spec/report-only diffs while retaining the other ready and CI checks; rules out changing markdown policy.

## Constraints

- Keep the slow v1 run-command file intact; rules out partitioning it as part of runner parity.
- Do not repair publication-time red gates; rules out expanding test-contract enforcement into ready recovery.

## Tasks

- Share roster composition and per-file execution policy across aggregate and scoped test commands.
- Guard aggregate/scoped roster equality, policy equality, and changed-path classification.
- Document the protected scoped-CI/unscoped-ready boundary and remove the temporary incident warnings.

## Documentation updates

- `v2/docs/operator-runbook.md` — state the protected CI/aggregate boundary and replace the temporary aggregate-drift incident warning.
- `v2/docs/v1-behaviors.md` — record test roster, execution-policy, path-selection, and ready semantics.
- `v1/docs/operator-runbook.md` — replace the temporary aggregate-drift incident warning with the durable contract cross-reference.

## Acceptance criteria

- [ ] `test/test-slices.test.ts` proves the aggregate roster is exactly the union of all six scoped rosters and fails if either side drifts.
- [ ] `test/test-slices.test.ts` has a policy-parity regression that fails against the pre-fix code and proves scoped and aggregate files share timeout, subprocess isolation, and failure handling.
- [ ] `scripts/ci-test-scope.test.ts` proves `v1/**`, `v2/**`, `shared/**`, `test/**`, root-tooling, unknown, unresolved-base, and docs/spec/report-only changes select the defined scope.
- [ ] `bun run typecheck`, `bun run test:v1`, and the relevant root-tooling test suite stay green.
- [ ] `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, and `v1/docs/operator-runbook.md` state the protected scoped-CI/unscoped-ready contract without the temporary incident warning.
