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
- Steering targets the selected run only — rules out steering a non-selected row
  or broadcasting to all runs.
- No selection → steering action is a no-op with operator-visible feedback — rules
  out sending RPCs with a null `runId`.
- Each action maps 1:1 to `TuiDaemonClient.pause` / `resume` / `kill` on the
  selected `runId` — rules out client-side guard logic beyond selection presence.
- Mid-session steering RPC errors render as operator-visible `<code>: <message>`
  feedback and keep the monitor open — rules out exit `1` after liveness proof
  (entry-time failures unchanged).
- Successful steering does not exit the monitor — rules out auto-quit after an
  action.
- List refresh, selection, and `wait` behavior from the monitor slice stay
  unchanged — rules out folding launch, log tail, or outcome-layout work into
  this slice.
- Steering AC verification uses an injectable monitor-controls seam until
  production keybindings land — rules out unpinned production bindings blocking
  AC verification.
- Deferred to first consumer: production keybindings and kill confirmation UX —
  pin in refine.
- Deferred to first consumer: steering success feedback layout — pin when
  production keybindings land.

## Task checklist

- Extend monitor controls with injectable `pauseSelected`, `resumeSelected`, and
  `killSelected` callbacks wired to the open `TuiDaemonClient`.
- Surface steering RPC errors in monitor-visible feedback (`<code>: <message>`).
- No-op with feedback when no run is selected.
- Preserve monitor list refresh, selection, `wait`, and quit semantics.
- Co-locate tests with injectable daemon client and monitor-controls fakes
  covering success, representative daemon errors, and no-selection no-op.
- Update operator docs per Documentation updates.

## Acceptance criteria

- [ ] With injectable monitor controls and a fixture client, `pauseSelected` sends `pause` for the selected `runId` and the monitor stays open.
- [ ] With injectable monitor controls and a fixture client, `resumeSelected` sends `resume` for the selected `runId` and the monitor stays open.
- [ ] With injectable monitor controls and a fixture client, `killSelected` sends `kill` for the selected `runId` and the monitor stays open.
- [ ] With injectable monitor controls and a fixture client returning `TuiDaemonRpcError` for a steering action, the monitor shows `<code>: <message>` and stays open.
- [ ] With injectable monitor controls and no selected run, a steering action does not invoke `pause`, `resume`, or `kill` and shows operator-visible feedback.
- [ ] After a successful steering action, list refresh and `wait` for the selected run continue on the existing monitor loop.
- [ ] `jarvis tui` entry-time connect/liveness/`list` failures still exit `1` with existing feedback; mid-session steering errors do not change that contract.
- [ ] Co-located tests cover steering success, at least one each of `unknown_run`, `terminal_run`, and a guard violation (`run_not_active`, `run_in_progress`, or `worktree_claimed`), and no-selection no-op with injectable fakes.
- [ ] `v2/src/tui-entry.test.tsx` stays green with expectations updated for steering (monitor no longer read-only for run control).
- [ ] `v2/docs/write-behavior.md` TUI section documents pause/resume/kill on the selected run, daemon pass-through semantics, mid-session steering error feedback, and that production keybindings are not pinned yet.
- [ ] `v2/docs/v2-architecture.md` Interface cross-links `jarvis tui` run monitor to daemon steering RPCs (one sentence; no duplicate wire contract).
- [ ] `v2/docs/v1-behaviors.md` has a `[v2 additive]` entry for TUI run-monitor steering under TUI/observability.
- [ ] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — expand TUI CLI:
  steering actions on selected run, daemon semantics pass-through, mid-session
  error feedback; note production keybindings deferred.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) — one-sentence
  cross-link from TUI run monitor to daemon `pause`/`resume`/`kill`.
- [`v2/docs/v1-behaviors.md`](../../docs/v1-behaviors.md) — `[v2 additive]` TUI
  run-monitor steering.
