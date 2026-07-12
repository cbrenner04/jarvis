# 00 - Retire old terminal runs from daemon list

`list` (`v2/src/daemon/daemon.ts`, `listHandler`) returns every durable run row forever: `store.listRuns()` is `ORDER BY created_at DESC` with no bound, and each row then costs a `store.loadRun` plus a full `logReader.tail` replay. The TUI polls `list` once per second, so terminal history grows the payload and the per-poll cost without limit.

Bound the terminal history `list` returns. Durable records are untouched; only the list view is filtered.

## Decisions

- Bound is count-based: `list` returns at most the 50 newest terminal runs. Rejected age-based: an age window leaves payload size unbounded under burst runs, and payload size is what the 1 Hz TUI poll pays for.
- 50 is an arbitrary starting point, not a derived number — a module constant, cheap to change once operator experience says otherwise.
- Terminal statuses subject to retention: `completed`, `failed`, `blocked`, `killed`. Every other `RunStatus` (`in-progress`, `queued`, `paused`, `budget-soft-stopped`, `awaiting-human`, `revising`) is exempt and always returned, however many exist. Rejected bounding all statuses: a retired live or awaiting-human run is unreachable from `run list`/TUI.
- The cap counts terminal runs only; exempt runs do not consume cap slots. Rejected a single cap over all rows, which would let a burst of live runs push retained terminal history out.
- Accepted trade: this bounds the terminal class, not total list size. `paused` and `budget-soft-stopped` never auto-transition, so abandoned runs in those states stay listed forever and are never capped. Visibility wins — an invisible paused run cannot be resumed or killed — but `list` is not unconditionally bounded.
- Workflow step runs are retained by invocation, not individually: a terminal run is also kept when a kept run shares its `workflowSnapshot.invocationId`. `listHandler` builds the workflow step map from the same row set it renders, and `workflowRowSnapshot` reports a step with no run in that map as `pending`/0 attempts — so retiring the finished step runs of a still-listed workflow would report finished steps as pending. That is wrong data, not truncation. Kept companion step runs do not consume cap slots.
- Retention is decided on the durable rows from `listRuns()` before the per-row `loadRun` + `tail` loop, so it also bounds list cost. `stepId` and `workflowSnapshot` are already columns on those rows, so invocation grouping costs no `loadRun`. Rejected filtering the assembled `runList`, which pays the replay cost for rows it then drops.
- The store deletes nothing and `listRuns()` keeps returning all rows; it gains `, rowid DESC` as an `ORDER BY` tiebreak so the cap boundary is deterministic under `created_at` ties (sibling queries in the same store already tiebreak this way). Rejected pushing a `LIMIT` into SQL — the count applies per-status-class and interacts with invocation retention.
- The bound is a module constant, not config. Rejected an operator-facing knob absent a request for one.

## Task checklist

- [ ] Add `, rowid DESC` to the `listRuns()` `ORDER BY` in `v2/src/persistence/state-store.ts`.
- [ ] Filter `store.listRuns()` in `listHandler` before the `loadRun`/`tail` loop: keep all exempt-status rows, the first 50 terminal-status rows, and any terminal row whose `workflowSnapshot.invocationId` matches a kept row; emit survivors in the store's order.
- [ ] Add co-located tests driving `listHandler` in-process via `listRunsDirect` (`v2/src/testing/run-control.ts`).
- [ ] Document retention and the exempt statuses in `v2/docs/daemon-host.md`.

## Acceptance criteria

- [x] With more than 50 terminal runs persisted, `list` returns only the 50 newest by creation time; the older terminal runs are absent from the response.
- [x] Runs with status `in-progress`, `queued`, `paused`, `budget-soft-stopped`, `awaiting-human`, or `revising` are always present in `list`, even when terminal history exceeds the bound and even when they are older than every retained terminal run.
- [x] Exempt-status runs do not consume the terminal bound: with 60 exempt runs and 50 terminal runs persisted, all 110 are returned.
- [x] A workflow with a listed run and completed step runs older than the terminal bound (60 newer unrelated terminal runs persisted) reports those steps as `completed` with their real attempt counts, not `pending`/0.
- [x] The returned runs stay in global creation order, newest first, with exempt and retained terminal rows interleaved — not exempt rows grouped ahead of or behind terminal rows.
- [x] Two runs sharing a `created_at` value land on the same side of the cap boundary across repeated `list` calls.
- [x] Runs retired from `list` remain readable from the state store (`loadRun` still returns them); no run rows are deleted.
- [x] `jarvis run list` and `jarvis tui` render every run the daemon returns, applying no bound of their own.
- [x] Retired runs are not loaded or log-replayed while serving `list`: with 200 terminal non-workflow runs and no exempt runs persisted, `list` issues at most 50 `loadRun` calls.
- [x] `daemon-start-list.sandbox-unrunnable.test.ts` stays green (its start→list round-trip run is exempt-status, so retention does not touch it).

## Documentation updates

- [ ] `v2/docs/daemon-host.md`: the `list` RPC row and surrounding prose state that terminal runs (`completed`, `failed`, `blocked`, `killed`) are bounded to the 50 newest, that all other statuses are exempt, and that step runs of a listed workflow invocation are retained regardless of the bound. Note that retention filters the response only — durable rows are kept.
