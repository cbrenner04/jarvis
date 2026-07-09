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
- Drop the parts of `runs single step to completion` already covered
  elsewhere (`result.kind`/`stepIndex`/`stepId`/`resumable` on a one-step
  workflow overlaps `implement preset and workflow snapshots stay one
  authored step`); keep only the one-step run-id-matches-actual-run
  assertion this test uniquely proves, or drop the test entirely if that
  assertion is redundant with the preset test.
- Drop `workflow-step execution reaches shared invocation with
  resolver-produced implement bindings` (quota-fallback rung-ordering
  re-proof) — rung ordering across quota is owned by
  `step-runner.test.ts` (`quota advances across resolved bindings and lands
  on the next agent head rung` and neighboring cases).
- Collapse the role-validation trio in `executeWorkflow load-time role
  validation` — `rejects a role absent from loaded config as aggregated
  per-agent misses before durable state change`, `aggregates multiple
  missing step-role-agent bindings in one load failure`, and `fails
  workflow load when an earlier agent has the role and a later fallback
  agent does not` — into one table-driven test asserting the aggregated
  error message per case. `treats inherited object properties as missing
  workflow role bindings` and `revalidates the loaded step array on resume
  against resume-time config, including already-completed steps` stay as
  separate tests (distinct behaviors: prototype-pollution safety, resume
  revalidation).
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

- [ ] `workflow-runner.test.ts` has no test named `runs two-step workflow to
      completion`.
- [ ] `workflow-runner.test.ts` has no test named `workflow-step execution
      reaches shared invocation with resolver-produced implement bindings`.
- [ ] The role-validation trio (`rejects a role absent from loaded config as
      aggregated per-agent misses before durable state change`, `aggregates
      multiple missing step-role-agent bindings in one load failure`, `fails
      workflow load when an earlier agent has the role and a later fallback
      agent does not`) is replaced by one table-driven test in the same
      describe block; `treats inherited object properties as missing
      workflow role bindings` and `revalidates the loaded step array on
      resume against resume-time config, including already-completed steps`
      remain as separate, unmodified-in-intent tests.
- [ ] Every `openStateStore(":memory:")` call in `workflow-runner.test.ts`
      goes through a shared fixture exported from
      `v2/src/testing/write-fixtures.ts` instead of a hand-rolled
      try/finally.
- [ ] `bun test v2/src/execution/workflow-runner.test.ts` passes.
- [ ] `step-runner.test.ts`, `workflow-loader.test.ts`, and
      `implement-workflow-steps.test.ts` are unmodified and still pass,
      confirming quota-fallback rung-ordering coverage survives at that
      layer.
- [ ] PR body states the test-count diff vs baseline (before/after count in
      `workflow-runner.test.ts`) and names every dropped test with its
      surviving owner (test name + file).

## Documentation updates

None — internal test-suite structure, not documented behavior.
