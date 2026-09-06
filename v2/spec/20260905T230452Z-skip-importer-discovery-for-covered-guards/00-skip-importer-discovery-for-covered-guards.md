# Skip importer discovery for covered guards

## Problem

- `resolveKillingTests` always unions direct importers after co-located resolution and fails closed as `importer-discovery-cap-exceeded` on a 201st inspected candidate under the surface-prefix scan root, even when exact-stem or sibling co-located coverage is already non-empty.
- Once a surface exceeds 200 `*.test.ts` files, every changed guard in that surface blocks — including guards with perfect co-located killing tests.

## Behavior

- When exact-stem or sibling co-located resolution yields a non-empty union, skip importer discovery entirely, scope mutation execution to co-located killing tests only, and never return `importer-discovery-cap-exceeded` for that guard.
- When co-located resolution is empty, preserve direct-importer discovery and today's fail-closed outcomes (`missing-killing-test` for an empty union; bounded cap exhaustion for uncovered guards).

## Decision ledger

- Skip importer discovery when co-located resolution is non-empty; co-located suffices and direct importers are not unioned — rules out always-union-then-cap and surface-total candidate counting for covered guards.
- Preserve direct-importer discovery and fail-closed outcomes for uncovered guards — rules out removing importer discovery or weakening cap/missing-killing semantics for the empty-co-located case.
- Deferred to first consumer: whether uncovered-guard cap exhaustion counts realized importers, inspected candidates, or another bound — pin when an uncovered guard hits cap in production telemetry.
- `returns importer-discovery-cap-exceeded without scoped execution when co-located coverage exists and discovery hits the cap` in `diff-derived-mutation-verifier.test.ts` is inverted by this change — rules out changing resolver code without updating that landmine and the union-scope test.
- `discovers only v2/src scan-root candidates…` cap half uses implicit exact-stem co-located coverage today — rules out citing that block wholesale as uncovered-guard cap preservation after the co-located skip.

## Tasks

- Short-circuit `resolveKillingTests` after co-located resolution when the union is non-empty; do not call `listImporterCandidates` or increment the inspection counter for covered guards.
- Add a sibling-only co-located regression with >200 scan-root candidates; assert pass without `importer-discovery-cap-exceeded` and that `listImporterCandidates` is never invoked (spy or call-count seam).
- Invert `returns importer-discovery-cap-exceeded without scoped execution when co-located coverage exists and discovery hits the cap` to expect scoped execution on co-located tests only.
- Update `runs scoped mutation execution on the deduplicated co-located ∪ direct-importer union and excludes unrelated tests` so covered guards scope only co-located killing tests (direct importers excluded).
- Refactor `discovers only v2/src scan-root candidates, ignores transitive and cross-surface importers, and fails closed on cap exhaustion`: keep scan-root prefix and transitive/cross-surface assertions on fixtures valid under the co-located skip; move cap exhaustion to an empty-co-located fixture (`excludeExactStem(true)`, no sibling `listDir`).
- Fix `a changed guard whose only killing test is a non-sibling direct importer passes when that importer kills the mutation` to use empty co-located fixture (`excludeExactStem(true)`, no sibling `listDir`) and assert scoped execution uses `directImporter` only.
- Add or refactored cap block proving an uncovered guard with empty co-located resolution still returns `importer-discovery-cap-exceeded` with zero scoped runs when a 201st candidate would be inspected.
- Update `KILLING_TEST_RULE` in `write-loop-input.ts` so implement/mutation-repair prompts match co-located-first resolution; align `write.test.ts` pinning.
- Align durable workflow, operator, write-behavior, and parity-baseline docs with the co-located skip.

## Acceptance criteria

- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a changed guard with sibling-only co-located coverage does not trigger importer discovery and never returns `importer-discovery-cap-exceeded` when its surface holds more than 200 `*.test.ts` files; fails against the always-union-then-cap resolver reachable on main today.
- [x] The >200 sibling-only regression asserts `listImporterCandidates` is never called (spy or call-count seam); fails against main today's always-union-then-cap resolver reachable on main today.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` `returns importer-discovery-cap-exceeded without scoped execution when co-located coverage exists and discovery hits the cap` expects scoped execution on co-located tests only; fails against main today.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` `runs scoped mutation execution on the deduplicated co-located ∪ direct-importer union and excludes unrelated tests` scopes only co-located killing tests for covered guards (direct importers excluded from the union); fails against main today because it currently expects `[directImporter, sibling]`.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` `a changed guard whose only killing test is a non-sibling direct importer passes when that importer kills the mutation` uses empty co-located fixture (`excludeExactStem(true)`, no sibling `listDir`) and scopes only `directImporter`; fails against the co-located skip resolver when the fixture still includes implicit exact-stem coverage via default `importerFixtureReadFile()` (reachable on main today).
- [x] After refactoring `discovers only v2/src scan-root candidates, ignores transitive and cross-surface importers, and fails closed on cap exhaustion`, its scan-root prefix and transitive/cross-surface importer assertions stay green; cap exhaustion is covered by a dedicated empty-co-located block (not the refactored scan-root/transitive half).
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves an uncovered guard with empty co-located resolution returns `importer-discovery-cap-exceeded` with zero scoped runs when a 201st scan-root candidate would be inspected; fails against a resolver that skips importer discovery unconditionally (reachable by inverting the co-located-empty guard in `resolveKillingTests`).
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` `reports missing-killing-test when neither co-located nor direct-importing tests exist` stays green.
- [x] `v2/src/execution/write-loop-input.ts` `KILLING_TEST_RULE` states co-located-first resolution (importer discovery only when co-located coverage is absent); `v2/src/execution/write.test.ts` implement and mutation-repair prompt pinning stays aligned; fails against main today's unconditional co-located ∪ direct-importer union wording.
- [x] `v2/docs/workflow-runner.md` documents that importer discovery runs only when co-located coverage is absent, the cap no longer blocks covered guards, and scoped execution for covered guards uses co-located tests only.
- [x] `v2/docs/operator-runbook.md` documents that flip-and-test recovery for `importer-discovery-cap-exceeded` no longer applies when co-located coverage is present.
- [x] `v2/docs/write-behavior.md` documents that importer discovery is not run for covered guards and cap prose reflects the co-located skip.
- [x] `v2/docs/v1-behaviors.md` records the corrected importer-discovery and cap behavior in the parity baseline.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — importer discovery runs only when co-located coverage is absent; cap no longer blocks covered guards; scoped execution for covered guards uses co-located tests only.
- `v2/docs/operator-runbook.md` — flip-and-test recovery for `importer-discovery-cap-exceeded` no longer applies when co-located coverage is present.
- `v2/docs/write-behavior.md` — cap prose reflects the co-located skip; importer discovery is not run for covered guards.
- `v2/docs/v1-behaviors.md` — record the corrected importer-discovery and cap behavior in the parity baseline.
- `v2/src/execution/write-loop-input.ts` — `KILLING_TEST_RULE` matches co-located-first resolution; align `write.test.ts` pinning.
