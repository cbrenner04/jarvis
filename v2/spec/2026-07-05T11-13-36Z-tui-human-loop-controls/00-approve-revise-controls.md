# 00 - Approve/revise/resume/kill controls for awaiting-human runs

A run sitting at `awaiting-human` today has no TUI control surface: the rendered
ink monitor only binds `q`/Ctrl-C to quit (`v2/src/tui/tui-ink-monitor.tsx`).
`TuiMonitorControls.pauseSelected/resumeSelected/killSelected` exist and are
wired through `tui-entry.tsx` to the daemon `pause`/`resume`/`kill` RPCs, but no
key triggers them. There is also no way to send an `approve`/`revise` human-loop
decision (`v2/src/daemon/daemon.ts` `resumeAwaitingHuman`) from the TUI at all —
`TuiDaemonClient.resume` only takes a `runId`, with no `decision`/`prompt`.

The plain `resume`/`kill` RPCs only act on a run tracked in the daemon's
in-memory `activeRuns` map (`daemon.ts:538`, `:560`); an `awaiting-human` run has
already been removed from `activeRuns`; sending it a bare `resume` rejects with
`"Missing decision for awaiting-human run"` and `kill` rejects with
`run_not_active`. The daemon's only mechanism for ending an `awaiting-human` run
is `resume(runId, { decision: "abort" })` (`resumeAwaitingHuman`, `daemon.ts:701`).

## Decisions

- New keys on the selected run: `a` approve, `v` revise, `k` kill. `r` resume is
  **not** bound for `awaiting-human` rows — plain `resume` has no effect on this
  state (`pause` stays unbound too; both out of scope for this intent).
- `approve`/`revise`/`k` on an `awaiting-human` run all go through
  `client.resume(runId, { decision, prompt? })`: `a` → `decision: "approve"`,
  `v` → `decision: "revise", prompt` (see below), `k` → `decision: "abort"`.
  This is the existing `resumeAwaitingHuman` RPC, not new server-side semantics —
  only the TUI's use of `decision` is new.
- `k` on a selected run that is **not** `awaiting-human` (i.e. actively running/paused)
  keeps calling the existing unmodified `client.kill(runId)` — same key, dispatched
  by the selected run's status.
- `revise` enters a local composing mode: keystrokes append to an in-monitor text
  buffer, `Enter` submits (empty buffer submits `prompt: undefined`), `Escape` cancels
  without sending. Buffer state is local to the ink component, not part of `TuiMonitorState`.
- Errors from any of the three (including the daemon's own `"Missing decision"` /
  `"revise requires..."` rejections) surface via the existing inline `steeringFeedback`
  path — no new error UI.

## Task Checklist

- [ ] Extend `TuiDaemonClient.resume` (`v2/src/tui/tui-daemon-client.ts`) to accept an
      optional `{ decision?: "approve" | "abort" | "revise"; prompt?: string }` second
      argument, forwarded as RPC params.
- [ ] Add `approveSelected()`, `reviseSelected(prompt?: string)` to `TuiMonitorControls`
      (`v2/src/tui/tui-monitor-types.ts`), and make `killSelected()` dispatch to
      `client.resume(runId, { decision: "abort" })` when the selected run's status is
      `awaiting-human` and the existing `client.kill(runId)` otherwise; wire all three in
      `tui-entry.tsx` alongside the existing `runSteeringAction` pattern.
- [ ] Bind `a`/`v`/`k` in `tui-ink-monitor.tsx` (no `r` binding on `awaiting-human` rows),
      including the revise composing mode (buffer entry, `Enter`/`Escape`).
- [ ] Render the composing-mode buffer as a visible line while active
      (`monitorTextLines` or component-local render).

## Acceptance criteria

- [x] Pressing `a` on a selected `awaiting-human` run sends decision `approve` and the
      run's status reflects the daemon's `approve` outcome (`completed`).
- [x] Pressing `v` on a selected `awaiting-human` run enters composing mode; typed text
      is sent as `prompt` on `Enter`, and `Escape` cancels without any RPC call.
- [x] Pressing `k` on a selected `awaiting-human` run sends decision `abort` and the run's
      status reflects the daemon's abort outcome (`killed`); pressing `k` on a selected
      actively-running/paused run calls the existing `kill` RPC unchanged.
- [x] A rejected decision (e.g. revise-exhausted) surfaces inline via `steeringFeedback`
      without closing the monitor.

## Documentation updates

- Update `v2/docs/v2-architecture.md`'s TUI/steering section (around the existing
  `pause`/`resume`/`kill` scope note) to list the three `awaiting-human` row keys
  (`a`/`v`/`k`), the `approve`/`revise`/`abort` decision path, and that `resume` is
  not bound for this state.
