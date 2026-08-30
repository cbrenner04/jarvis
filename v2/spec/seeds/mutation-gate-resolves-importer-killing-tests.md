# Mutation gate resolves killing tests by importer, not only co-location

## Problem

Killing-test resolution is naming-convention-only: exact-stem `<stem>.test.ts` plus sibling `<stem>-*.test.ts` (added in #3172). So the gate enforces *co-location*, not *coverage* — a changed guard genuinely killed by a test in a different file that imports the module still strands on `missing-killing-test`. The pre-#3172 `workflow-runner.ts` strands were partly this class, and `durable-run-backed` #3173 hit it on relocated operator-error-mapping code whose real coverage lives in the original module's directory.

## Decisions

- Killing tests for a changed module = the union of (a) co-located resolution (exact-stem + `<stem>-*.test.ts`, from #3172) and (b) direct-importer test files: test files in the same surface whose import specifiers resolve to the changed module. Rules out co-location-only resolution.
- The importer scan is direct-importers only (a changed module `foo.ts` → test files importing `./foo.ts` / the module path), a cheap static import scan bounded to a maximum count; no transitive graph walk. Rules out an unbounded dependency-graph traversal that would balloon verifier wall clock.
- `missing-killing-test` fires only when the union (co-located ∪ direct-importer) is empty. A mutation is killed if any test in the union fails under it. Rules out weakening the fail-closed behavior when no test exists.
- Update `KILLING_TEST_RULE` in `v2/src/execution/write-loop-input.ts` and the docs — the current "resolves killing tests only from co-located files, with no fallback to the wider suite" wording becomes stale once importer resolution lands.

## Acceptance criteria

- [ ] A verifier test proves a changed guard whose only killing test is in a **non-sibling importing** test file yields NO `missing-killing-test` when that importer kills the mutation; it fails against the co-location-only resolver.
- [ ] A verifier test proves a module with no co-located and no importing test still fails `missing-killing-test` (fail-closed on empty union).
- [ ] A verifier test proves the importer scan is bounded (direct importers only, capped count) and does not run unrelated test files.
- [ ] `KILLING_TEST_RULE` and the workflow-runner docs no longer claim co-located-only resolution.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — killing-test resolution is co-located ∪ direct-importer; `missing-killing-test` on empty union.
- `v2/src/execution/write-loop-input.ts` — `KILLING_TEST_RULE` wording updated to name the importer path.

## Sequencing

Extends the #3172 sibling resolver. Independent of [[implement-verifies-mutations-in-loop]] but complements it (fewer false `missing-killing-test` reprompts).
