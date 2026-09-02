---
name: notification-sweep-derives-bounded-incident-set
---

# The notification sweep re-derives all history every 5s and starves the daemon event loop

## Problem

`runNotificationSweep` fires on a 5-second timer and calls `deriveOperatorIncidents(store)`, which recomputes **every incident in all of history** on every tick. Nothing bounds it by time, retention, or actionability, so its cost grows monotonically with the state store and is paid forever.

Per sweep, at the operator's current store (3,567 runs / 60 pipelines / 514 stages / 3,331 delivery rows):

- `store.listRuns()` — unbounded `SELECT … FROM runs ORDER BY created_at DESC` with a JSON decode per row, to read `workflowSnapshot?.invocationId`. It does not take the fifty-terminal retention window `run list` uses.
- `store.listPipelines()` twice (main loop + `collectPipelineAttributedRunIds`), each materializing all stages.
- Per stage, `redrivableDeferredSettlementEntryRunId` → `loadRun`, and `collectPipelineAttributedRunIds` → `loadRun` + `findRunsByInvocationId`: ~1,500 extra queries.
- `collectRunIncidents` then emits a `run-ad-hoc-terminal` incident for every terminal workflow run ever recorded — 2,798 completed + 420 failed + 276 blocked. The delivery ledger suppresses re-*delivery*; it does not avoid re-*derivation*.

The sweep is synchronous on the daemon event loop, so while it runs the daemon answers no RPCs.

## Evidence (2026-09-02)

Controlled A/B, same build, same copied state store, only `notificationSinkCommand` differing:

```text
t=15s  97.8% sink-on  |  0.0% sink-off
t=30s  98.5% sink-on  |  0.1% sink-off
t=45s  97.9% sink-on  |  0.2% sink-off
```

On the live daemon (PID 68640) sustained sampling shows the 5-second cycle directly: `0.7 → 11.5 → 98.4 → 87.4`.

Operator-visible failure: the daemon binds its socket, logs `Daemon running on socket …`, and then never answers. `jarvis daemon status` reads `stopped` — because its probe connects and times out, not because nothing is listening — so the operator retries `daemon start`, and **each retry stacks another 95%-CPU spinner on the same socket key**. Seven accumulated in one session (load average 18 with zero jarvis work in flight), presenting as the documented superseded-daemon and `daemon stop`/`run kill` deadlock shapes while being neither. A macOS `sample` of a wedged daemon shows the time in `libsqlite3` page reads and JSON blob translation, consistent with the full-table run scan.

## Decisions

- Derive incidents from a **bounded candidate set**, not from all history. Only rows that can still be operator-actionable participate: non-terminal and recently-settled runs, and non-terminal or recently-settled pipelines. Age out the rest — a run that settled weeks ago and is already in the delivery ledger can never owe a new notification.
- Push the bound into SQL. `deriveOperatorIncidents` must not call an unbounded `listRuns()`; add a store query that filters by status and a `since` bound so the JSON decode is paid only for candidate rows.
- Kill the N+1 stage loads: `collectPipelineAttributedRunIds` and `redrivableDeferredSettlementEntryRunId` should share one batched lookup per sweep rather than two `loadRun` calls per stage.
- **Guard against overlap.** A sweep that outruns its 5-second interval must not have another queued behind it — skip the tick when the prior sweep is still running.
- Sweep cost must be **independent of store size**: a store with 100 runs and one with 100,000 do the same work when the actionable set is identical.

## Acceptance criteria

- [ ] `deriveOperatorIncidents` does not enumerate terminal runs older than the actionable bound — pinned by a test that seeds a store with many old terminal runs plus a small actionable set and asserts the derived incident set contains only the actionable ones.
- [ ] Sweep work does not grow with store size — pinned by a test asserting the store-query count (or rows decoded) is unchanged between a small store and one padded with old terminal rows whose actionable set is identical.
- [ ] A run already recorded in the delivery ledger is not re-derived on later sweeps — pinned by a test.
- [ ] Two sweeps cannot run concurrently: a tick fired while a sweep is in progress is skipped, not queued — pinned by a test.
- [ ] Stage-attributed run resolution issues one batched lookup per sweep rather than per-stage `loadRun` calls — pinned by a test counting store calls.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: state the bounded candidate set and the no-overlap guarantee.
- `v2/docs/operator-runbook.md` — § Daemon lifecycle: a daemon that binds its socket but never answers reads as `stopped`; retrying `daemon start` stacks spinners. Record the distinguishing check against the superseded-daemon and deadlock shapes.
