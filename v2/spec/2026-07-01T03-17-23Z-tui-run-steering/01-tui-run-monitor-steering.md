# 01 — TUI run monitor steering

Wire pause, resume, and kill into the interactive `jarvis tui` run monitor for
the selected run. Steering vocabulary matches daemon RPC semantics; RPC failures
surface as operator-visible messages without leaving the monitor.

## Prerequisites

- Merged TUI daemon steering RPCs:
  `./00-tui-daemon-steering-rpcs.md`.
- Merged TUI run monitor:
  `v2/spec/completed/2026-06-30T21-06-57Z-tui-run-monitor/01-tui-run-monitor-view.md`.

## Decisions

- Steering surface is `pause` / `resume` / `kill` only — rules out controls no
  daemon verb supports.
- Kill is immediate; pause is graceful at iteration boundary — rules out remapping
  semantics in the UI layer.
- Steering targets the selected row regardless of list `isLive` — daemon rejects
  invalid transitions; rules out client pre-gating on liveness or terminal list
  status.
- No selection → steering action is a no-op with operator-visible feedback `no
  run selected` — rules out sending RPCs with a null `runId` or
  `<code>: <message>` copy for no-selection.
- Each action maps 1:1 to `TuiDaemonClient.pause` / `resume` / `kill` on the
  selected `runId` — rules out client-side guard logic beyond selection presence.
- Mid-session steering feedback is session-local inline state on the monitor view
  (same pattern as log-follow `showFeedback`), not entry-time full-screen ink —
  rules out `viewHost.show` for steering feedback.
- Steering feedback lifecycle: replace on next steering action; clear on
  selection change; `waitState` errors unchanged — rules out persistent feedback
  across unrelated actions.
- Mid-session steering RPC errors render inline as `<code>: <message>`; mid-session
  `TuiDaemonConnectionError` renders inline as `daemon_error: <message>` — rules
  out exit `1` after liveness proof (entry-time failures unchanged).
- Successful steering does not exit the monitor — rules out auto-quit after an
  action.
- After successful `resume`, re-issue `wait` for the selected `runId` the same way
  `setSelection` does (abandon prior ready snapshot; `waitState` → `pending`) —
  rules out stale quiescent outcome while the run is live again.
- List refresh, selection, and `wait` behavior from the monitor slice stay
  unchanged — rules out folding launch, log tail, or outcome-layout work into
  this slice.
- Steering AC verification uses an injectable monitor-controls seam until
  production keybindings land — rules out unpinned production bindings blocking
  AC verification.
- Document steering behavior, error format, and pass-through semantics now;
  production keybindings and success-feedback layout remain deferred — rules out
  delaying behavioral docs until keybindings land.
- Deferred to first consumer: production keybindings and kill confirmation UX —
  pin in refine.
- Deferred to first consumer: steering success feedback layout — pin when
  production keybindings land.

## Task checklist

- Extend monitor controls with injectable `pauseSelected`, `resumeSelected`, and
  `killSelected` callbacks wired to the open `TuiDaemonClient`.
- Add session-local steering feedback on monitor state; surface RPC errors as
  `<code>: <message>` and connection errors as `daemon_error: <message>` inline;
  apply lifecycle clear rules.
- No-op with `no run selected` when no run is selected.
- After successful `resume`, re-issue `wait` for the selected run.
- Preserve monitor list refresh, selection, `wait`, and quit semantics.
- Co-locate tests with injectable daemon client and monitor-controls fakes
  covering success, per-action provokable daemon errors, connection errors, and
  no-selection no-op.
- Update operator docs per Documentation updates.

## Acceptance criteria

- [ ] With injectable monitor controls and a fixture client, `pauseSelected` sends `pause` for the selected `runId` and the monitor stays open.
- [ ] With injectable monitor controls and a fixture client, `resumeSelected` sends `resume` for the selected `runId` and the monitor stays open.
- [ ] With injectable monitor controls and a fixture client, `killSelected` sends `kill` for the selected `runId` and the monitor stays open.
- [ ] With injectable monitor controls and a fixture client returning `TuiDaemonRpcError` for a steering action, the monitor shows `<code>: <message>` inline and stays open.
- [ ] With injectable monitor controls and a fixture client throwing `TuiDaemonConnectionError` on a steering action, the monitor shows `daemon_error: <message>` inline and stays open.
- [ ] With injectable monitor controls and no selected run, a steering action does not invoke `pause`, `resume`, or `kill` and shows `no run selected`.
- [ ] With injectable monitor controls and fixture client, steering feedback replaces on the next steering action and clears on selection change; `waitState` error display is unchanged.
- [ ] After successful `resume` on a run whose prior `wait` returned quiescent, the monitor re-issues `wait` for the selected `runId` (`waitState` → `pending`) and abandons the prior ready snapshot.
- [ ] After other successful steering actions, list refresh and `wait` for the selected run continue on the existing monitor loop.
- [ ] `jarvis tui` entry-time connect/liveness/`list` failures still exit `1` with existing feedback; mid-session steering errors do not change that contract.
- [ ] Co-located tests cover steering success, `unknown_run` on any action, `run_not_active` on `pause` or `kill`, a `resume`-only guard (`terminal_run`, `run_in_progress`, or `worktree_claimed`), connection error, and no-selection no-op with injectable fakes.
- [ ] `v2/src/tui-entry.test.tsx` test `the monitor never sends steering RPCs` is inverted/replaced with steering expectations and stays green.
- [ ] `v2/docs/write-behavior.md` TUI section documents pause/resume/kill on the selected run, daemon pass-through semantics (including steering a terminal/non-active row surfaces daemon errors inline with no client pre-gating), mid-session steering error feedback (`<code>: <message>` and `daemon_error: <message>`), inline feedback lifecycle, and that production keybindings are not pinned yet.
- [ ] `v2/docs/write-behavior.md` Verification bullet for `tui-entry.test.tsx` includes steering scope.
- [ ] `v2/docs/v2-architecture.md` Interface cross-links `jarvis tui` run monitor to daemon steering RPCs (one sentence; no duplicate wire contract).
- [ ] `v2/docs/v1-behaviors.md` has a `[v2 additive]` entry for TUI run-monitor steering under TUI/observability.
- [ ] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — expand TUI CLI:
  steering actions on selected run, daemon pass-through semantics (no client
  pre-gating on liveness/terminal list rows), mid-session error feedback and
  lifecycle; note production keybindings and success-feedback layout deferred;
  update Verification bullet for `tui-entry.test.tsx` steering scope.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) — one-sentence
  cross-link from TUI run monitor to daemon `pause`/`resume`/`kill`.
- [`v2/docs/v1-behaviors.md`](../../docs/v1-behaviors.md) — `[v2 additive]` TUI
  run-monitor steering.
