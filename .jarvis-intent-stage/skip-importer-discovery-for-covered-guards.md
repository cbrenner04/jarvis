---
name: skip-importer-discovery-for-covered-guards
---

# Skip importer discovery for guards with co-located coverage

Unsplit rationale: The resolver change, verifier regressions, and durable documentation all live on the execution-loop diff-derived mutation verifier surface; no persistence, daemon, or CLI boundary changes.

## Primary implementation surface

- Execution-loop diff-derived mutation verification in `v2/src/execution/diff-derived-mutation-verifier.ts`

## Prerequisites

- Diff-derived mutation verification resolves exact-stem and sibling co-located killing tests and discovers direct importers under the surface-prefix scan root with a 200-candidate inspection cap.

## Problem

- `resolveKillingTests` scans every `*.test.ts` under the surface-prefix scan root and fails closed as `importer-discovery-cap-exceeded` on a 201st inspected candidate even when co-located coverage is already non-empty, so once a surface exceeds 200 test files every changed guard in that surface blocks — including guards with perfect co-located killing tests.

## Behavior

- When exact-stem or sibling co-located resolution yields a non-empty union, skip importer discovery entirely and never return `importer-discovery-cap-exceeded` for that guard.
- When co-located resolution is empty, preserve direct-importer discovery and today's fail-closed outcomes (`missing-killing-test` for an empty union; bounded cap exhaustion for uncovered guards).

## Decision ledger

- Skip importer discovery when co-located resolution is non-empty; rules out always-union-then-cap and surface-total candidate counting for covered guards.
- Preserve direct-importer discovery and fail-closed outcomes for uncovered guards; rules out removing importer discovery or weakening cap/missing-killing semantics for the empty-co-located case.
- Deferred to first consumer: whether uncovered-guard cap exhaustion counts realized importers, inspected candidates, or another bound — pin when an uncovered guard hits cap in production telemetry.
- Update the shipped spec ACs and durable docs that require importer discovery even with co-located coverage; rules out changing resolver code without revising the landmine ACs.

## Acceptance criteria

- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a changed guard with co-located (exact-stem or sibling) coverage does not trigger importer discovery and never returns `importer-discovery-cap-exceeded` when its surface holds more than 200 `*.test.ts` files; the test fails against the always-union-then-cap resolver reachable on main today.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves an uncovered changed guard still resolves direct-importer tests and still fails closed as `missing-killing-test` for an empty union or a bounded cap outcome; importer discovery is preserved for the case it exists for.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — importer discovery runs only when co-located coverage is absent; the cap no longer blocks covered guards.
- `v2/docs/v1-behaviors.md` — record the corrected importer-discovery and cap behavior in the parity baseline.
