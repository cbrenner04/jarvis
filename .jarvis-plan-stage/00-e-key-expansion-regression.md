# E key drives workflow expansion in rendered output

No test presses **`e`** through the ink input handler, invokes
`toggleSelectedWorkflowExpansion` from `tui-entry.tsx`, or asserts constituent
workflow rows in rendered monitor output. Expansion tests seed
`expandedWorkflowInvocationIds`; `tui-ink-monitor.test.tsx` stubs the control as a
no-op.

## Decisions

- Pinning test runs `runTuiEntry` without `viewHost`, with injected `inkRender`
  supplying `useInput` (same seam as `tui-ink-monitor.test.tsx`) — rules out
  ink-only test with duplicate toggle logic that never executes
  `tui-entry.tsx` `toggleSelectedWorkflowExpansion`.
- Fixture is a collapsed multi-run workflow with a selected workflow row
  (reuse `tui-monitor-workflow-collapse.test.ts` run shape) — rules out
  single-run rows that do not exercise collapse/expand rendering.
- Assertions read concatenated rendered monitor row texts (`collectRowTexts` /
  `joinMonitorRow` on the ink capture tree), not `expandedWorkflowInvocationIds`
  or `createViewHost` monitor snapshots — rules out seeding expansion state and
  view-model-only checks a no-op control stub would satisfy.
- Second **`e`** press must collapse rendered output back to one top-level
  workflow row — rules out one-way expand-only coverage.
- Guard inversion via comment checkpoints on the pinning test naming production
  guard mutations — rules out `setInvert*ForTest` production hooks.
- Operator-visible expansion behavior unchanged — rules out operator-runbook or
  `v1-behaviors.md` churn.

## Tasks

- Add `tui-entry.test.tsx` regression: `runTuiEntry` without `viewHost`, injected
  `inkRender` + `useInput`, workflow `list` fixture, selected collapsed workflow
  row; press **`e`** twice via the input handler.
- Assert rendered rows: collapsed initially (constituent `run-implement` absent);
  after first **`e`**, both constituent run ids present with distinct role labels;
  after second **`e`**, collapsed again.
- Add comment checkpoints on the pinning test documenting guard inversion:
  (1) remove or bypass the `input === "e"` branch in `tui-ink-monitor.tsx`;
  (2) empty `toggleSelectedWorkflowExpansion` in `tui-entry.tsx`.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — new regression driving **`e`** through the injected
      ink input handler fails against baseline and passes after implementation;
      rendered constituent workflow rows appear on the first press and disappear on
      the second without seeding `expandedWorkflowInvocationIds`.
- [ ] (Manual) Comment checkpoints on the pinning test name both guard mutations
      (`tui-ink-monitor.tsx` **`e`** binding; `tui-entry.tsx`
      `toggleSelectedWorkflowExpansion` body); operator verifies each mutation
      turns the pinning test RED.
- [ ] `tui-ink-monitor.test.tsx` — `drives quit and kill through the injected
      input hook` and `drives row navigation through the injected input hook`
      stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None. Operator runbook already documents **`e`** expansion; test-only coverage
  gap — no behavior change.
