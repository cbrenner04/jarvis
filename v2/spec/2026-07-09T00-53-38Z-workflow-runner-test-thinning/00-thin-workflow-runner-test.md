# Thin workflow-runner.test.ts

`v2/src/execution/workflow-runner.test.ts` carries subsumed, duplicated, and
mechanically repeated coverage. Thin it without touching src or dropping any
unique behavior.

## Decisions

- Drop `runs two-step workflow to completion` (`executeWorkflow` describe
  block) — its assertions (independent attempt history, distinct completed
  run ids per step) are subsumed by `runs the write-write preset end to end
  with per-step resolution, ordered advancement, fallback, and separate
  durable history`.
- Shrink `runs single step to completion` to just the one-step
  run-id-matches-actual-run assertion — drop `result.kind`/`stepIndex`/
  `stepId`/`resumable` coverage (subsumed by `implement preset and workflow
  snapshots stay one authored step`). Keep the shrunk test rather than
  deleting it outright: the run-id assertion is not asserted by the preset
  test, so it stays the owner of that one behavior.
- Drop `workflow-step execution reaches shared invocation with
  resolver-produced implement bindings` (quota-fallback rung-ordering
  re-proof) — rung ordering across quota is owned by
  `step-runner.test.ts` (`quota advances across resolved bindings and lands
  on the next agent head rung` and neighboring cases). This only removes a
  redundant rung-ordering re-proof; shared-invocation/resolver wiring
  coverage itself stays owned by `implement-workflow-steps.test.ts` and the
  step-runner tests, so no integration point loses its only test.
- Collapse the role-validation trio in `executeWorkflow load-time role
  validation` — `rejects a role absent from loaded config as aggregated
  per-agent misses before durable state change`, `aggregates multiple
  missing step-role-agent bindings in one load failure`, and `fails
  workflow load when an earlier agent has the role and a later fallback
  agent does not` — into one table-driven test asserting the aggregated
  error message per case. The table must keep the no-mutation-on-failure
  invariant from the first test: one shared assertion (outside the per-row
  loop, e.g. after the table runs, or per-row if cheap) that durable state
  is unchanged after a load failure — do not drop it silently. Minimal
  column shape: `{ name, stepRoleAgentBindings, expectedAggregatedError }`,
  with one row per original case (single missing role, multiple missing
  bindings, earlier-agent-has-role-later-fallback-doesn't). `treats
  inherited object properties as missing workflow role bindings` and
  `revalidates the loaded step array on resume against resume-time config,
  including already-completed steps` stay as separate tests (distinct
  behaviors: prototype-pollution safety, resume revalidation).
- Extract the repeated `openStateStore(":memory:")` + `try { ... } finally {
  store.close(); }` pattern into a shared fixture in
  `v2/src/testing/write-fixtures.ts` (alongside `createJarvisHome` /
  `trackedTempRoots`), e.g. a `withStateStore` helper that opens an
  in-memory store, runs a callback, and closes it in `finally`. Convert
  every `openStateStore(":memory:")` call site in
  `workflow-runner.test.ts` to use it.

## Out of scope

- Src changes (`v2/src/execution/workflow-runner.ts` and friends).
- Dropping quota-fallback rung-ordering coverage at the resolver
  (`workflow-loader.test.ts`, `implement-workflow-steps.test.ts`) or
  step-runner (`step-runner.test.ts`) layer — those stay untouched and
  remain the owners of that behavior.
- Non-index-related restructuring of other test files.

## Acceptance criteria

- [x] `workflow-runner.test.ts` has no test named `runs two-step workflow to
      completion`.
- [x] `workflow-runner.test.ts` has no test named `workflow-step execution
      reaches shared invocation with resolver-produced implement bindings`.
- [x] `runs single step to completion` asserts only the one-step
      run-id-matches-actual-run behavior; its `result.kind`/`stepIndex`/
      `stepId`/`resumable` assertions are gone.
- [x] The role-validation trio (`rejects a role absent from loaded config as
      aggregated per-agent misses before durable state change`, `aggregates
      multiple missing step-role-agent bindings in one load failure`, `fails
      workflow load when an earlier agent has the role and a later fallback
      agent does not`) is replaced by one table-driven test in the same
      describe block, and that test still asserts durable state is
      unmutated after a load failure; `treats inherited object properties as
      missing workflow role bindings` and `revalidates the loaded step array
      on resume against resume-time config, including already-completed
      steps` remain as separate, unmodified-in-intent tests.
- [x] Every `openStateStore(":memory:")` call in `workflow-runner.test.ts`
      goes through a shared fixture exported from
      `v2/src/testing/write-fixtures.ts` instead of a hand-rolled
      try/finally.
- [x] `bun test v2/src/execution/workflow-runner.test.ts` passes.
- [x] `step-runner.test.ts`, `workflow-loader.test.ts`, and
      `implement-workflow-steps.test.ts` are unmodified and still pass,
      confirming quota-fallback rung-ordering coverage survives at that
      layer.
- [x] PR body states the test-count diff vs baseline (before/after count in
      `workflow-runner.test.ts`) and names every dropped test with its
      surviving owner (test name + file).

## Documentation updates

None — internal test-suite structure, not documented behavior; no runtime or
operator behavior changes, so `v2/docs/v1-behaviors.md` needs no update.
