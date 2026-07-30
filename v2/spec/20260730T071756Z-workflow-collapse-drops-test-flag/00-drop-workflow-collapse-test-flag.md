# Drop workflow collapse test flag

`setInvertWorkflowCollapseForTest` is mutable production state. The invert test
proves collapse by toggling that flag, so the criterion stays green if the real
collapse path is deleted.

## Decisions

- Delete `invertWorkflowCollapseForTest`, `setInvertWorkflowCollapseForTest`,
  and the `buildWorkflowTableRows` early-return branch — rules out keeping a
  test hook because toggling it satisfies the collapse criterion without the
  guard. No replacement production test hooks.
- Remove `inverted collapse shows every constituent run as a top-level row` —
  its negative contract (N top-level rendered monitor rows for N shared-invocation
  members when collapse is bypassed) is carried by
  `collapsed table shows one top-level row for a multi-run workflow` turning
  red under source mutation, not a dedicated invert `test()` or production
  bypass branch.
- Guard inversion via comment checkpoint on the pinning test — matching
  `daemon-workflow-start.test.ts` / `workflow-runner.test.ts` — rules out a
  mandatory new automated test when the existing positive render test already
  pins the guard.
- Prove inversion on the collapse path itself (`seenInvocations` dedup +
  `workflow-collapsed` emit in `buildWorkflowTableRows`), not a parallel bypass
  — rules out a second production branch that simulates “no collapse.”
- Operator-visible collapse behavior unchanged — rules out operator-runbook or
  `v1-behaviors.md` churn for this harness-only fix.

## Tasks

- Remove `invertWorkflowCollapseForTest`, `setInvertWorkflowCollapseForTest`,
  and the early-return from `v2/src/tui/tui-monitor-workflow-collapse.ts`.
- Drop `setInvertWorkflowCollapseForTest` import, `afterEach` reset, and
  `inverted collapse shows every constituent run as a top-level row` from
  `v2/src/tui/tui-monitor-workflow-collapse.test.ts`.
- Add a comment checkpoint on `collapsed table shows one top-level row for a
  multi-run workflow` documenting guard inversion: bypass = disabling full
  collapse grouping on the real path (every shared-invocation constituent as its
  own top-level rendered row; N rows for N members); mutation target =
  `seenInvocations` dedup + `workflow-collapsed` emit in `buildWorkflowTableRows`.
  No new automated test required.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-monitor-workflow-collapse.ts` exports no
      `setInvertWorkflowCollapseForTest`, contains no
      `invertWorkflowCollapseForTest` module variable, `buildWorkflowTableRows`
      has no test-flag branch, and no replacement production test hooks were
      added.
- [ ] `tui-monitor-workflow-collapse.test.ts` — `inverted collapse shows every
      constituent run as a top-level row` is removed; guard inversion is
      documented in a comment checkpoint on `collapsed table shows one top-level
      row for a multi-run workflow` naming bypass as disabling full collapse
      grouping (N top-level rendered monitor rows for N shared-invocation
      members) via mutation of the `seenInvocations` dedup +
      `workflow-collapsed` emit block in `buildWorkflowTableRows`; operator
      verifies the pinning test turns red under that mutation. (Manual)
- [ ] `tui-monitor-workflow-collapse.test.ts` — `collapsed table shows one
      top-level row for a multi-run workflow` stays green (rendered monitor
      text via `tableBodyLines`; behavior unchanged by the flag removal).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None. Operator-visible collapse behavior unchanged; `v1-behaviors.md` out of
  scope — removes test-only production branch only.
