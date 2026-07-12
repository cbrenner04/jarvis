# 00 - Retire old terminal runs from daemon list

`list` (`v2/src/daemon/daemon.ts`, `listHandler`) returns every durable run row forever: `store.listRuns()` is `ORDER BY created_at DESC` with no bound, and each row then costs a `store.loadRun` plus a full `logReader.tail` replay. The TUI polls `list` once per second, so terminal history grows the payload and the per-poll cost without limit.

Bound the terminal history `list` returns. Durable records are untouched; only the list view is filtered.

## Decisions

- Bound is count-based: `list` returns at most the 50 newest terminal runs, ordered by the existing `created_at DESC`. Rejected age-based: an age window leaves payload size unbounded under burst runs, and payload size is what the 1 Hz TUI poll pays for.
- Terminal statuses subject to retention: `completed`, `failed`, `blocked`, `killed`. Every other `RunStatus` (`in-progress`, `queued`, `paused`, `budget-soft-stopped`, `awaiting-human`, `revising`) is exempt and always returned, however many exist. Rejected bounding all statuses: a retired live or awaiting-human run is unreachable from `run list`/TUI.
- The cap counts terminal runs only; exempt runs do not consume cap slots. Rejected a single cap over all rows, which would let a burst of live runs push retained terminal history out.
- Retired rows are dropped before the per-row `loadRun` + `logReader.tail` work, so retention also bounds list cost. Rejected filtering the assembled `runList`.
- The store is unchanged: `listRuns()` keeps returning all rows and no records are deleted. Rejected pushing a `LIMIT` into SQL — the count applies per-status-class, and other `listRuns` callers want the full set.
- The bound is a module constant, not config. Rejected an operator-facing knob absent a request for one.

## Task checklist

- [ ] Filter `store.listRuns()` in `listHandler` before the `loadRun`/`tail` loop: keep all exempt-status rows, keep only the first 50 terminal-status rows in `created_at DESC` order.
- [ ] Add co-located tests driving `listHandler` in-process via `listRunsDirect` (`v2/src/testing/run-control.ts`).
- [ ] Document retention and the exempt statuses in `v2/docs/daemon-host.md`.

## Acceptance criteria

- [ ] With more than 50 terminal runs persisted, `list` returns only the 50 newest by creation time; the older terminal runs are absent from the response.
- [ ] Runs with status `in-progress`, `queued`, `paused`, `budget-soft-stopped`, `awaiting-human`, or `revising` are always present in `list`, even when terminal history exceeds the bound and even when they are older than every retained terminal run.
- [ ] Exempt-status runs do not consume the terminal bound: with 60 exempt runs and 50 terminal runs persisted, all 110 are returned.
- [ ] Runs retired from `list` remain readable from the state store (`loadRun` still returns them); no run rows are deleted.
- [ ] `jarvis run list` and `jarvis tui` show the bounded set, inheriting the daemon's filtering with no client-side truncation of their own.
- [ ] Retired runs are not loaded or log-replayed while serving `list` (a `list` over 200 terminal runs issues at most 50 `loadRun` calls).
- [ ] `daemon-start-list.test.ts` stays green (unbounded-history behavior is the only change).

## Documentation updates

- [ ] `v2/docs/daemon-host.md`: the `list` RPC row and surrounding prose state that terminal runs (`completed`, `failed`, `blocked`, `killed`) are bounded to the 50 newest, and that all other statuses are exempt from retention. Note that retention filters the response only — durable rows are retained.
