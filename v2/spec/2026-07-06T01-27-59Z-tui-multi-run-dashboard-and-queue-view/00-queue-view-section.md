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
- Queue rows are ordered oldest-first (FIFO, matching daemon promotion order),
  not the newest-first order `list` returns overall — a newest-first queue
  reading would misrepresent which run promotes next.
- Each queued row shows an admission-pending reason. Today the daemon queues
  a run for exactly one reason (memory headroom below `machine.memory.minFreeGb`);
  render a fixed descriptor rather than a dynamic reason field the daemon
  does not emit. Deferred to first consumer: a per-row dynamic reason string —
  pin when the daemon gains a second queuing cause.
- Queued rows are not selectable via `selectRun`/steering controls (pause,
  resume, kill, approve, revise) — a queued run has no active write loop, so
  daemon steering RPCs already reject it as `run_not_active`. Excluding queued
  runs from the selectable set at the view layer avoids surfacing a
  confusing steering error for a row that was never actionable.
- Selection (`selectedRunId`, initial-selection-on-connect, fallback when the
  selected run disappears from the list) considers only non-queued rows.

## Task checklist

- [ ] Add a queue-lines helper (or extend `monitorTextLines`) that partitions
      `state.runs` into non-queued and queued groups, rendering the queue
      group under a "Queue" heading with the FIFO ordering and admission
      descriptor above.
- [ ] Restrict `tui-entry.tsx` selection logic (`firstRunId`, the
      `selectedRunId` disappearance check, and the `selectRun` control guard)
      to non-queued rows.

## Acceptance criteria

- [ ] `jarvis1 tui` renders queued runs under a distinct "Queue" heading,
      separate from the non-queued run list, each showing project, branch,
      and an admission-pending descriptor (e.g. "waiting: memory headroom").
- [ ] Queue rows are ordered oldest-queued-first.
- [ ] Initial run selection on connect, and the selection-loss fallback when
      the selected run leaves the list, never choose a `queued` run.
- [ ] Invoking `selectRun` with a `queued` run's id is a no-op (selection
      unchanged).

## Documentation updates

- Update `v2/docs/v2-architecture.md` (or the TUI's existing behavior
  description, if present) to describe the dashboard/queue split.
