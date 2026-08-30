---
name: resolve-importing-killing-tests
---

# Resolve importing killing tests

Unsplit rationale: The resolver, scoped test execution, prompt rule, and durable documentation all belong to execution-loop mutation verification; no second module boundary changes.

## Primary implementation surface

- Execution-loop mutation verification in `v2/src/execution/diff-derived-mutation-verifier.ts`

## Prerequisites

- Diff-derived mutation verification resolves an existing exact-stem `<stem>.test.ts` plus sibling `<stem>-*.test.ts` files as co-located killing tests.

## Problem

- The mutation gate treats only co-location as coverage, so a non-sibling test that directly imports and kills a changed module still yields `missing-killing-test`.
- The implement and mutation-repair prompt rule and workflow documentation require co-located tests, preserving the false failure after resolver behavior changes.

## Behavior

- Resolve each changed module's killing tests as the union of co-located tests and same-surface test files whose static import specifiers resolve directly to that module.
- Run only that bounded union; any failing member kills the mutation, while an empty union fails closed as `missing-killing-test`.
- Align `KILLING_TEST_RULE` and durable workflow documentation with importer-aware resolution.

## Decision ledger

- Union direct-importer tests with exact-stem and sibling tests; rules out replacing or weakening established co-located resolution.
- Scan only same-surface test files with direct static imports and stop at a cap; rules out transitive dependency traversal and wider-suite execution.
- Emit `missing-killing-test` only for an empty union and accept a kill from any union member; rules out treating importer discovery as advisory fallback.
- Deferred to first consumer: direct-importer scan cap value — pin when the mutation verifier integration needs it.

## Acceptance criteria

- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a changed guard whose only killing test is a non-sibling direct importer does not yield `missing-killing-test` when that importer fails under mutation; the test fails against the co-location-only resolver.
- [ ] The importing-test regression carries an in-body `// @mutate v2/src/execution/diff-derived-mutation-verifier.ts "if (killingTests.length === 0) {" -> "if (true) {"` checkpoint that names the real empty-union guard and turns the scoped test red; production inversion hooks are absent.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a changed module with neither co-located nor direct-importer tests still yields `missing-killing-test`.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves importer discovery is direct-only and capped and that scoped execution excludes unrelated tests.
- [ ] Implement and mutation-repair prompts tell agents that co-located or direct-importing tests can supply killing coverage.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — document co-located ∪ direct-importer killing-test resolution, bounded direct-only discovery, any-member kill semantics, and `missing-killing-test` for an empty union.
- `v2/docs/v1-behaviors.md` — replace the co-located-only parity baseline with the importer-aware existing behavior.
