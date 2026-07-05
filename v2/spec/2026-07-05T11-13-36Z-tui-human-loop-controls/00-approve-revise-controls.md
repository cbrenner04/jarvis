# 00 - Approve/revise/resume/kill controls for awaiting-human runs

A run sitting at `awaiting-human` today has no TUI control surface: the rendered
ink monitor only binds `q`/Ctrl-C to quit (`v2/src/tui/tui-ink-monitor.tsx`).
`TuiMonitorControls.pauseSelected/resumeSelected/killSelected` exist and are
wired through `tui-entry.tsx` to the daemon `pause`/`resume`/`kill` RPCs, but no
key triggers them. There is also no way to send an `approve`/`revise` human-loop
decision (`v2/src/daemon/daemon.ts` `resumeAwaitingHuman`) from the TUI at all —
`TuiDaemonClient.resume` only takes a `runId`, with no `decision`/`prompt`.

## Decisions

- New keys on the selected run: `a` approve, `v` revise, `r` resume, `k` kill.
  Only these four are added; `pause` stays unbound (out of scope for this intent).
- `approve`/`revise` call `client.resume(runId, { decision, prompt? })`; `resume`/`kill`
  keep calling the existing unmodified `client.resume(runId)` / `client.kill(runId)` —
  reuse, not new RPC semantics.
- `revise` enters a local composing mode: keystrokes append to an in-monitor text
  buffer, `Enter` submits (empty buffer submits `prompt: undefined`), `Escape` cancels
  without sending. Buffer state is local to the ink component, not part of `TuiMonitorState`.
- Errors from any of the four (including the daemon's own `"decision required"` /
  `"revise requires..."` rejections) surface via the existing inline `steeringFeedback`
  path — no new error UI.

## Task Checklist

- [ ] Extend `TuiDaemonClient.resume` (`v2/src/tui/tui-daemon-client.ts`) to accept an
      optional `{ decision?: "approve" | "abort" | "revise"; prompt?: string }` second
      argument, forwarded as RPC params.
- [ ] Add `approveSelected()` and `reviseSelected(prompt?: string)` to `TuiMonitorControls`
      (`v2/src/tui/tui-monitor-types.ts`) and wire them in `tui-entry.tsx` alongside the
      existing `runSteeringAction` pattern.
- [ ] Bind `a`/`v`/`r`/`k` in `tui-ink-monitor.tsx`, including the revise composing mode
      (buffer entry, `Enter`/`Escape`).
- [ ] Render the composing-mode buffer as a visible line while active
      (`monitorTextLines` or component-local render).

## Acceptance criteria

- [ ] Pressing `a` on a selected `awaiting-human` run sends decision `approve` and the
      run's status reflects the daemon's `approve` outcome (`completed`).
- [ ] Pressing `v` on a selected `awaiting-human` run enters composing mode; typed text
      is sent as `prompt` on `Enter`, and `Escape` cancels without any RPC call.
- [ ] Pressing `r` on the selected run calls the existing `resume` RPC unchanged; pressing
      `k` calls the existing `kill` RPC unchanged.
- [ ] A rejected decision (e.g. missing decision, revise-exhausted) surfaces inline via
      `steeringFeedback` without closing the monitor.

## Documentation updates

- Update `v2/docs/v2-architecture.md`'s TUI/steering section (around the existing
  `pause`/`resume`/`kill` scope note) to list the four run-row keys and the
  `approve`/`revise` decision path.
