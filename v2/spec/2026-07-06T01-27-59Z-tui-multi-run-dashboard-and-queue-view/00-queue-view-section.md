# Split queued runs into a distinct queue section

Today `jarvis1 tui` renders every run — including `queued` ones — in one flat
list with no indication of why a queued run hasn't started. An operator can't
tell, at a glance, which runs are actually progressing versus waiting on
memory headroom to admit them.

## Decisions

- Render two labeled groups in the existing monitor view — "Runs" (non-queued)
  and "Queue" (`status: "queued"`) — instead of introducing a second
  screen/tab the operator must switch to; the monitor is already a single
  flat-text view and no consumer has asked for multi-screen navigation.
- Queue rows are ordered oldest-first (FIFO), matching only the
  memory-headroom admission check — the sole queuing cause today — not the
  newest-first order `list` returns overall. This does not guarantee absolute
  promotion order: the daemon separately skips promoting a queued run whose
  project/branch is already claimed by an active run, so a later-queued run
  for a free project/branch can promote ahead of an earlier one still
  blocked by that claim. Deferred to first consumer: surfacing the
  claim-skip exception in the UI — pin if operators report confusion.
- Each queued row shows an admission-pending reason. Today the daemon queues
  a run for exactly one reason (memory headroom below `machine.memory.minFreeGb`);
  render a fixed descriptor string rather than a dynamic reason field the
  daemon does not emit. Deferred to first consumer: a per-row dynamic reason
  string — pin when the daemon gains a second queuing cause.
- Queued rows keep the same per-row fields as non-queued rows (runId,
  project, branch, status) for visual/log correlation, but replace the
  liveness field with the admission-pending descriptor — a queued run has no
  liveness signal to show.
- Queued rows are not selectable via `selectRun`/steering controls (pause,
  resume, kill, approve, revise): queued runs are absent from `activeRuns`,
  so steering RPCs already return `run_not_active` as a side effect of that
  lookup, not because of a queued-specific guard. Excluding queued runs from
  the selectable set at the view layer avoids surfacing that error for a row
  that was never actionable.
- Selection (`selectedRunId`, initial-selection-on-connect, fallback when the
  selected run disappears from the list) considers only non-queued rows.
- No cursor/arrow-key navigation path exists in the monitor view today;
  selection is exclusively via the programmatic `selectRun` control, already
  restricted above to non-queued rows.
- Empty-section rendering: the "Runs" section always renders, even with zero
  non-queued runs (consistent with the existing "No runs." precedent). The
  "Queue" heading renders only when at least one queued run exists; it is
  omitted entirely otherwise.
- Layout: the "Runs" section renders first, then (if non-empty) a "Queue"
  heading, then one line per queued run — each line includes that run's
  admission descriptor inline, matching how non-queued rows render as single
  lines. The descriptor is not a separate line.
- Non-goal: cancelling or dequeuing a queued run is out of scope — no daemon
  dequeue RPC exists. This subspec is display-only.

## Task checklist

- [ ] Add a queue-lines helper (or extend `monitorTextLines`) that partitions
      `state.runs` into non-queued and queued groups: render "Runs" first
      (always, even empty), then a "Queue" heading only when queued runs
      exist, each queued row FIFO-ordered on one line with runId, project,
      branch, and the admission descriptor in place of liveness.
- [ ] Restrict `tui-entry.tsx` selection logic (`firstRunId`, the
      `selectedRunId` disappearance check, and the `selectRun` control guard)
      to non-queued rows.
- [ ] No wire/type changes needed — the descriptor is a TUI-side literal;
      `DaemonListRunRow` has no reason field and none is being added.

## Acceptance criteria

- [x] `jarvis1 tui` renders queued runs under a distinct "Queue" heading,
      separate from the non-queued run list, each showing runId, project,
      branch, status, and the fixed admission-pending descriptor
      "waiting: memory headroom".
- [x] The "Queue" heading is omitted entirely when no runs are queued; the
      "Runs" section still renders when it is empty.
- [x] Queue rows are ordered oldest-queued-first.
- [x] Initial run selection on connect, and the selection-loss fallback when
      the selected run leaves the list, never choose a `queued` run.
- [x] Invoking `selectRun` with a `queued` run's id is a no-op (selection
      unchanged).

## Documentation updates

- Update the TUI behavior section of `v2/docs/v2-architecture.md` to describe
  the Runs/Queue split.
