# E key drives workflow expansion in rendered output

No test presses **`e`** through the ink input handler, invokes
`toggleSelectedWorkflowExpansion` from `tui-entry.tsx`, or asserts constituent
workflow rows in rendered monitor output. Expansion tests seed
`expandedWorkflowInvocationIds`; `tui-ink-monitor.test.tsx` stubs the control as a
no-op.

## Decisions

- Coverage combines `inputHarness`-style `InjectedInkUi` / `useInput` injection
  (ink monitor test pattern) with `runTuiEntry` without `viewHost` (entry test
  pattern) — rules out ink-only test with a no-op `toggleSelectedWorkflowExpansion`
  stub that never exercises `tui-entry.tsx` wiring.
- `RunTuiEntryDeps.inkRender` accepts the same injection shape `openInkMonitor`
  already takes (`InkRender | InjectedInkUi`) — rules out unsafe casts blocking
  `useInput` injection; type alignment only, no operator-visible behavior change.
- Pinning test uses `createRefreshScheduler()` (or equivalent no-op scheduler) —
  rules out refresh races during async open and input presses.
- Fixture is the standard three-member workflow from
  `tui-monitor-workflow-collapse.test.ts`: completed `run-implement`, in-progress
  `run-review`, queued `run-verify`. Terminal-window filtering and
  `firstSelectableRunId` must resolve to the collapsed workflow representative
  (workflow-bound selection), not a bare standalone row or queued-only member.
  Initial rendered state shows one top-level workflow row; **`e`** is not a silent
  no-op.
- Assertions read concatenated rendered row texts from the ink capture tree (extract
  or locally duplicate helpers such as `collectRowTexts` / `joinMonitorRow` as
  needed), not `expandedWorkflowInvocationIds` or `createViewHost` monitor snapshots
  — rules out seeding expansion state and view-model-only checks a no-op control
  stub would satisfy. Injected UI's Fragment layout (no `Box`) is an accepted
  pre-existing gap — same as existing ink input tests — not a layout-parity goal
  for this subspec.
- Rendered round-trip assertions are the automated proof that wiring is live; manual
  guard-inversion comment checkpoints confirm those assertions fail under guard
  removal — rules out `setInvert*ForTest` production hooks.
- Operator-visible expansion behavior unchanged — rules out operator-runbook or
  `v1-behaviors.md` churn.

## Tasks

- Align `RunTuiEntryDeps.inkRender` with `openInkMonitor`'s `InkRender |
  InjectedInkUi` type.
- Add `tui-entry.test.tsx` regression `drives workflow expansion through the
  injected input hook`: `runTuiEntry` without `viewHost`, `createRefreshScheduler`,
  injected `inkRender` + `useInput` (`inputHarness` pattern), workflow `list`
  fixture (three-member shape above); do not seed `expandedWorkflowInvocationIds`.
- Lifecycle: await monitor open / first render after list hydration → capture row
  texts → press **`e`** (post-press `waitUntilRenderFlush`, same as existing ink
  input tests) → assert expanded → press **`e`** again (flush) → assert collapsed →
  tear down via quit so `runTuiEntry` resolves.
- Assert rendered rows:
  - **Collapsed (initial):** constituent `run-implement` absent; workflow step label
    visible (`workflow-step:implement-review/actuator` on the top-level row).
  - **Expanded (after first `e`):** `run-implement` and `run-review` visible with
    `role:implement` and `workflow-step:implement-review/actuator` respectively;
    `run-verify` excluded as queued.
  - **Re-collapsed (after second `e`):** one top-level workflow row again.
- Add comment checkpoints on the pinning test documenting guard inversion:
  (1) remove or bypass the `input === "e"` branch in `tui-ink-monitor.tsx`;
  (2) empty `toggleSelectedWorkflowExpansion` in `tui-entry.tsx`.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — `drives workflow expansion through the injected input
      hook` drives **`e`** through the injected ink input handler without seeding
      `expandedWorkflowInvocationIds`; rendered constituent workflow rows appear on
      the first press and disappear on the second.
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
