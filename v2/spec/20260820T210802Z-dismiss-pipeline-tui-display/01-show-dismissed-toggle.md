# `D` toggles showing dismissed pipelines

## Problem

After `00`, `TuiMonitorState.showDismissed` decides whether dismissed pipelines paint, but nothing sets it: no key binding, no control, and `refreshRuns` still calls `client.pipelineList()` parameterless (`v2/src/tui/tui-entry.tsx`), so the daemon's default-excluding projection never returns a dismissed pipeline for the flag to reveal. An operator who dismisses a pipeline has no way back to it in the TUI, and the dock hint advertises no such control.

## Decision ledger

- The binding is `D` (shift), not `d`; rules out spending the lowercase key on a display toggle when a future dismiss/undismiss action on the selected pipeline is the natural `d`.
- Toggling issues an immediate refresh rather than waiting for the next poll tick; rules out a toggle that appears inert on the way on, since the retained snapshots hold no dismissed pipeline until the opt-in request returns.
- The request always carries an explicit `includeDismissed` boolean; rules out omitting the parameter when off — the daemon reads `params?.includeDismissed === true`, so absent and `false` are identical on the wire and the extra branch buys nothing.
- Toggling off relies on `00`'s projection filter to drop the dismissed snapshots already retained from the last opt-in response; rules out evicting them from `pipelineSnapshotsBySocketPath`, which would blank the tree until the next successful refresh.
- The dock hint atom is static (`D dismissed`), not state-reflecting; rules out a mode-dependent hint, since the marked rows already show which mode is active.
- A selection sitting on a row that the toggle hides falls through the existing selectable-id reconciliation in `refreshRuns` (selection resets to `null` when its id leaves `monitorSelectableNodeIds`); rules out new selection-repair handling for the toggle.
- The toggle is session state only; rules out persisting an operator preference to config or the state store, which this spec has no consumer for.

## Task checklist

- Add `toggleShowDismissed(): void` to `TuiMonitorControls` in `v2/src/tui/tui-monitor-types.ts`.
- Bind `D` to it in the tree-focus branch of `useInput` in `v2/src/tui/tui-ink-monitor.tsx`.
- Give `pipelineList` an `{ includeDismissed: boolean }` parameter that reaches the `pipeline_list` request frame in `v2/src/tui/tui-daemon-client.ts`.
- Implement the control in `v2/src/tui/tui-entry.tsx` (flip `showDismissed`, refresh immediately) and pass the flag on every `pipelineList` call in `refreshRuns`.
- Add the static `D dismissed` hint atom to `dockHintLine` in `v2/src/tui/tui-monitor-lines.ts`.
- Add the tests below with their in-body `// @mutate` directives to `v2/src/tui/tui-entry.test.tsx`, `v2/src/tui/tui-ink-monitor.test.tsx`, and `v2/src/tui/tui-monitor-lines.test.ts`; extend the existing stub `TuiMonitorControls` literals with the new method.
- Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A TUI entry test asserts the toggle issues a `pipeline_list` request carrying `includeDismissed: true` and that the pre-toggle requests carry `includeDismissed: false`; it fails against the pre-fix entry, which has no such control and always requests the parameterless snapshot.
- [ ] A TUI entry test asserts toggling a second time returns to `includeDismissed: false` requests and that the dismissed pipeline leaves the painted work tree again, without waiting for a snapshot eviction.
- [ ] A TUI entry test asserts the toggle refreshes on the spot — a `pipeline_list` request is issued before any refresh-scheduler tick fires.
- [ ] A TUI entry test asserts that with the toggle on, the daemon's opt-in snapshot paints the dismissed pipeline's row in the work tree carrying the `(dismissed)` marker.
- [ ] An ink-monitor test asserts `D` in tree focus invokes `toggleShowDismissed`, and that `D` while command input is focused inserts the character and invokes no control.
- [ ] A monitor-lines test asserts the dock hint line advertises the `D` dismissed toggle in tree focus and stays absent from the command-focus hint line.
- [ ] A fresh monitor session starts with dismissed pipelines hidden: the first `pipeline_list` request of a session carries `includeDismissed: false` regardless of any prior session (asserted in the entry test above; nothing is read from config or the state store).
- [ ] Existing `v2/src/tui/tui-entry.test.tsx` and `v2/src/tui/tui-ink-monitor.test.tsx` suites stay green (unbound keys, refresh behavior, and existing hint assertions unchanged by the new binding and request parameter).
- [ ] `v2/src/tui/tui-entry.test.tsx` — `the show-dismissed toggle requests the opt-in pipeline_list snapshot`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the `pipelineList` call back to the parameterless form restores baseline semantics (the TUI never asks for dismissed pipelines) and turns this test red.
- [ ] `v2/src/tui/tui-entry.test.tsx` — `toggling show-dismissed off returns to the default pipeline_list request`; Mutation checkpoint: an in-body `// @mutate` directive replacing the flip expression with a constant `true` makes the second toggle keep requesting dismissed pipelines and turns this test red — the negative case proving the toggle turns off.
- [ ] `v2/src/tui/tui-entry.test.tsx` — `the show-dismissed toggle refreshes immediately`; Mutation checkpoint: an in-body `// @mutate` directive replacing the control's refresh call with `return;` leaves the request until the next scheduler tick and turns this test red.
- [ ] `v2/src/tui/tui-ink-monitor.test.tsx` — `D toggles show-dismissed`; Mutation checkpoint: an in-body `// @mutate` directive replacing the `toggleShowDismissed()` call in the `D` branch with `return;` drops the binding and turns this test red.
- [ ] `v2/docs/operator-runbook.md` — the `jarvis tui` sections record `D` as the session-only show-dismissed toggle (immediate re-request of `pipeline_list` with `includeDismissed: true`, dismissed rows painting with the `(dismissed)` marker, default hidden on every new session, no persisted preference), and the stale "Pipeline/stage display rows are a separate concern tracked by the `dismiss-pipeline-*` ready intents" note under `run kill --force` is replaced by a pointer to `jarvis pipeline dismiss` plus this toggle.
- [ ] `v2/docs/v1-behaviors.md` — the existing `pipeline_list` dismissed-exclusion entry's "none of them pass `includeDismissed` yet" claim is amended: the TUI multi-daemon merge passes `includeDismissed` on every `pipeline_list` request, `true` only while the session's `D` toggle is on.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `D` toggle in the `jarvis tui` key/behavior sections, plus replacing the stale `dismiss-pipeline-*` ready-intent note under `run kill --force`.
- `v2/docs/v1-behaviors.md` — amend the `pipeline_list` dismissed-exclusion entry for the TUI opt-in.

## Implementer notes

- Suggested shape, keeping each guard quotable by one single-line `@mutate` directive:

  ```ts
  // tui-entry.tsx, in refreshRuns
  const pipelineResult = await client.pipelineList({ includeDismissed: currentState.showDismissed === true });

  // tui-entry.tsx, in the controls object
  toggleShowDismissed() {
    setState({ ...currentState, showDismissed: currentState.showDismissed !== true, steeringFeedback: null });
    void refreshRuns().catch(() => {});
  },
  ```

  `refreshRuns` already defaults `initial` to `false`, so the argument-less call is distinct from the scheduler's `void refreshRuns(false).catch(() => {});` and each stays a unique directive anchor.
- `tui-daemon-client.ts`: `pipelineList(params: { includeDismissed: boolean })` forwards straight into `transport.request("pipeline_list", params)`; the daemon reads `params?.includeDismissed === true` (`v2/src/daemon/daemon.ts`).
- `mergeMonitorSessionState` spreads `next`, so `showDismissed` reaches the rendered session state with no change in `tui-ink-monitor.tsx` beyond the key binding.
- The `D` branch belongs after the `e` branch and inside the existing `if (commandFocused) return;` guard, so command-focus insertion keeps working unchanged.
