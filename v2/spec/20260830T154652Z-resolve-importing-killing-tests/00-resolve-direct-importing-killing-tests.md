# Resolve direct-importing killing tests

## Prerequisites

- Diff-derived mutation verification resolves an existing exact-stem `<stem>.test.ts` plus sibling `<stem>-*.test.ts` files as co-located killing tests (#3172).

## Problem

- Diff-derived mutation verification recognizes only exact-stem and sibling co-located tests, so a non-sibling test that directly imports and kills a changed module still produces `missing-killing-test`.
- Implement and mutation-repair guidance requires co-located coverage, preserving the false failure after resolver behavior changes.

## Behavior

- Resolve each changed module's killing tests as the union of existing exact-stem tests, sibling `<stem>-*.test.ts` files, and direct-importing `*.test.ts` files discovered under that module's importer-scan root.
- Map a changed production path to its importer-scan root by the longest matching repo test-surface prefix: `v1/src/` → all `v1/src/**/*.test.ts`; `v2/src/` → all `v2/src/**/*.test.ts`; `shared/` → all `shared/**/*.test.ts`. Paths outside those prefixes get no importer scan — co-located union only; empty union → `missing-killing-test`.
- Discover importer candidates in lexicographic repository-relative order and inspect at most 200 candidates per changed production file. Exact-stem and sibling co-located paths do not consume that budget. Importer discovery always runs when building the union, even when co-located coverage already exists.
- Run only the resolved union; any failing member kills the mutation and an empty union fails as `missing-killing-test`.
- When a 201st importer candidate would be inspected for a changed production file, return `importer-discovery-cap-exceeded` as `surviving-mutation` with `sourceSite` naming that production file, without running scoped tests — even when co-located tests form a non-empty union.
- Align `KILLING_TEST_RULE` and durable workflow documentation with importer-aware resolution.

## Decision ledger

- Union direct importers with established co-located tests; rules out replacing or weakening exact-stem and sibling resolution.
- Importer-scan roots follow repo test-surface prefixes (`v1/src/`, `v2/src/`, `shared/`), not the production file's directory alone; paths outside known surfaces skip importer discovery; rules out cross-surface importer matches (for example a `v2/src/` module does not resolve `v1/src/**/*.test.ts` importers).
- Restrict discovery to `*.test.ts` only — not `.test.tsx` or `.spec.ts` — with direct static imports resolving to the changed module; rules out transitive traversal, cross-surface discovery, and wider-suite execution (known blind spot: TUI `.test.tsx` importers are excluded).
- Reuse the existing static relative-import resolver from `runtime-smoke-verifier` (`importedModulePaths` + `resolveImportedModule`); rules out a forked parser and inherits its `import` / `export … from` / relative `import()` behavior for `import type` and extensioned specifiers.
- Count inspected importer candidates, not resolved importers, toward the per-production-file 200-file bound; co-located exact-stem and sibling paths are outside that budget; rules out unbounded scans when few candidates import the module.
- Evaluate the importer cap per changed production candidate, not once for the whole verification pass; rules out one candidate's sprawl aborting unrelated files.
- Fail before scoped test execution when discovery would inspect a 201st candidate; rules out co-located-only fallback on cap exhaustion, trusting a partial union, or misreporting `missing-killing-test`.
- Surface `importer-discovery-cap-exceeded` through the same `surviving-mutation` channel as `missing-killing-test`, with `sourceSite` naming the changed production file; rules out a separate failure taxonomy.
- Keep the authoritative resolution contract in `v2/docs/workflow-runner.md`; rules out divergent definitions across workflow and operator docs.

## Tasks

- Extend diff-derived killing-test resolution with surface-prefix importer-scan roots, bounded direct-importer discovery, and cap-exhaustion failure surfacing.
- Preserve exact-stem and sibling resolution, deduplicate and sort the union, and pass only that union to scoped mutation execution.
- Add focused resolver, failure, execution-scope, cap-with-co-located-present, and real-guard inversion coverage without production inversion hooks.
- Align implement and mutation-repair step rules with importer-aware killing coverage.
- Update durable workflow, parity-baseline, and operator-facing mutation documentation without duplicating the authoritative contract.

## Acceptance criteria

- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a changed guard whose only killing test is a non-sibling direct importer does not yield `missing-killing-test` and returns pass when that importer kills the mutation under scoped execution; the regression fails against the co-location-only resolver.
- [ ] The importing-test regression in `v2/src/execution/diff-derived-mutation-verifier.test.ts` turns red when the real empty-union guard (`if (killingTests.length === 0)`) is manually inverted and returns green after restoration, without a production inversion seam.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a changed module with neither co-located nor direct-importing tests returns `missing-killing-test`.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves direct-importer discovery examines only `*.test.ts` files under the changed module's importer-scan root in lexicographic order, ignores transitive importers and cross-surface importers outside that prefix, returns `importer-discovery-cap-exceeded` before executing a partial union when a 201st candidate would be inspected, and when exact-stem co-located coverage exists with 201 discovery candidates still returns `importer-discovery-cap-exceeded` without invoking scoped test execution.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves scoped mutation execution receives the deduplicated co-located ∪ direct-importer union and excludes unrelated tests.
- [ ] `v2/src/execution/write.test.ts` proves implement and `write.mutation-repair` prompts inject `IMPLEMENT_WRITE_STEP_RULES` (including `KILLING_TEST_RULE`) and tell agents that co-located or direct-importing tests can supply killing coverage while wider-suite and transitive coverage remain excluded.
- [ ] `v2/docs/workflow-runner.md` documents the co-located ∪ direct-importer union, surface-prefix importer-scan roots and outside-prefix fallback, direct-only 200-candidate-per-file bound, cap-exhaustion `surviving-mutation` outcome, any-member kill semantics, and empty-union `missing-killing-test`.
- [ ] `v2/docs/v1-behaviors.md` replaces the co-located-only parity baseline with importer-aware behavior.
- [ ] `v2/docs/write-behavior.md` removes the co-located-only contradiction and points to the authoritative workflow contract.
- [ ] `v2/docs/operator-runbook.md` aligns mutation-gate troubleshooting with importer discovery, cap exhaustion (`importer-discovery-cap-exceeded` with co-located coverage present but execution blocked), and recovery (reduce same-root `*.test.ts` sprawl or add co-located killing coverage).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — own the importer-aware killing-test resolution contract, surface-prefix scan roots, and bounded failure semantics.
- `v2/docs/v1-behaviors.md` — replace the co-located-only parity baseline.
- `v2/docs/write-behavior.md` — remove the stale co-located-only definition and cross-link the workflow contract.
- `v2/docs/operator-runbook.md` — align operational diagnosis and recovery guidance for importer discovery and cap exhaustion.
