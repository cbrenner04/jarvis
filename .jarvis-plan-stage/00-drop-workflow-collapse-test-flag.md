# Drop workflow collapse test flag

`setInvertWorkflowCollapseForTest` is mutable production state. The invert test
proves collapse by toggling that flag, so the criterion stays green if the real
collapse path is deleted.

## Decisions

- Delete `invertWorkflowCollapseForTest`, `setInvertWorkflowCollapseForTest`,
  and the `buildWorkflowTableRows` early-return branch — rules out keeping a
  test hook because toggling it satisfies the collapse criterion without the
  guard.
- Replace `inverted collapse shows every constituent run as a top-level row`
  with guard mutation on the shared-invocation collapse path in
  `buildWorkflowTableRows` — rules out leaving a test that only exercises the
  deleted hook.
- Prove inversion on the collapse path itself (skip duplicate invocation /
  emit `workflow-collapsed`), not a parallel bypass — rules out a second
  production branch that simulates “no collapse.”
- Operator-visible collapse behavior unchanged — rules out operator-runbook or
  `v1-behaviors.md` churn for this harness-only fix.

## Tasks

- Remove the test globals and early-return from
  `v2/src/tui/tui-monitor-workflow-collapse.ts`.
- Drop `setInvertWorkflowCollapseForTest` import, `afterEach` reset, and the
  invert test from `v2/src/tui/tui-monitor-workflow-collapse.test.ts`.
- Add a replacement guard-inversion test that asserts shared-invocation runs
  collapse (view-model and/or rendered monitor text) and fails when the
  collapse path is bypassed via source mutation — follow the
  `daemon-workflow-start.test.ts` / `workflow-runner.test.ts` comment pattern
  if the positive render tests already pin the guard.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-monitor-workflow-collapse.ts` exports no
      `setInvertWorkflowCollapseForTest` and `buildWorkflowTableRows` contains
      no test-flag branch.
- [ ] `tui-monitor-workflow-collapse.test.ts` — replacement guard-inversion
      coverage for shared-invocation collapse fails when the collapse path in
      `buildWorkflowTableRows` is bypassed (source mutation) and passes after
      the flag removal; it does not call any production test hook.
- [ ] `tui-monitor-workflow-collapse.test.ts` — `collapsed table shows one
      top-level row for a multi-run workflow` stays green (behavior unchanged
      by the flag removal).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None. Operator-visible collapse behavior unchanged; removes test-only
  production branch only.
