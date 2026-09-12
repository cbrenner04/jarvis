---
name: owner-liveness-depends-on-timezone-agreement
---

# Owner-liveness comparison depends on two processes agreeing about a timezone-less timestamp, and a disagreement kills live runs

## Problem

`readProcessStartEpoch` (`v2/src/persistence/state-store.ts`) runs `ps -o lstart= -p <pid>` and `Date.parse`s the result. `ps` renders that timestamp with **no zone**, so `Date.parse` resolves it in the *reading* process's zone. Two processes that resolve different zones therefore compute different start epochs for the same pid.

`isOwnerAlive` compares the recorded `<pid>:<start-epoch>` identity against a freshly read epoch and returns `false` on mismatch. `beginRunReconciliation` treats `false` as "owner is dead" and `reconcileOrphanedRuns` settles every one of that owner's non-terminal runs to `killed` / `daemon_restart`. So a zone disagreement between the process that admitted a run and the daemon that later starts up **destroys live work**, with no inconclusive branch — the same inconclusive-is-permissive shape as the `gh pr list` probe and the socket outage.

The `process.kill(pid, 0)` step above it is already careful (only `ESRCH` proves death; `EPERM` is treated as alive). The epoch comparison then throws that care away: an unparseable epoch returns `null` and is treated as alive, but a *successfully parsed but differently-zoned* epoch is treated as proof of death.

## Evidence (2026-09-12)

Reproduced while hand-finishing the daemon handoff lane. Under `bun test`, Bun resolves the timezone to UTC (`Intl.DateTimeFormat().resolvedOptions().timeZone` is `UTC`, `process.env.TZ` unset) while `ps` renders in the machine's system zone:

```text
process.env.TZ: undefined
resolved zone: UTC
ps lstart: "Sat Sep 12 17:25:34 2026"
Date.parse(ps): 1789233934000 -> 2026-09-12T17:25:34.000Z    # actual start was 22:25:34Z
```

A run admitted by that process records `owner_identity` five hours early. A real spawned daemon reads the true epoch, mismatches, and reconciles the run:

```text
{"event":{"kind":"run_reconciled","runStatus":"killed","reason":"daemon_restart"}}
```

Observed as two failing tests in `generation-drain-and-exit.sandbox-unrunnable.test.ts` on a machine whose system zone is not UTC; the same file is 3/3 with the zone aligned. Cost: the failures read as a defect in the drain-observer wiring and were diagnosed as such twice before the zone was found. CI runs UTC-native on both sides, so it never sees this — which is what makes it expensive rather than merely wrong.

## Decisions

- Compare process identity on a value that is not timezone-dependent: prefer a monotonic or absolute source (for example `ps -o etime=`/`etimes=` reduced against `Date.now()`, or `/proc`-style start ticks where available) over parsing a zone-less rendered local time. Rules out the current `lstart` + `Date.parse` pair.
- A mismatch that cannot be established with confidence is **not** proof of death: an epoch that parses but disagrees resolves to "alive" unless the pid itself is gone, matching the existing `ESRCH`-only rule one line above. Rules out inconclusive-is-permissive on a destructive path.
- Recording and reading must use the same mechanism, and a test proves agreement across a process boundary where the two processes resolve different zones. Rules out a fix that is only correct when both sides happen to match.
- Scope is owner-liveness identity. No change to what reconciliation does once a run is genuinely orphaned. Rules out widening into reconciliation policy.

## Acceptance criteria

- [ ] A test proves the recorded identity and a cross-process liveness read agree for a live pid when the reading process resolves a different timezone from the recording process; it fails against the current `lstart`/`Date.parse` pair.
- [ ] A test proves an owner whose pid is alive but whose start-epoch comparison is inconclusive resolves as alive, and that only a pid confirmed gone (`ESRCH`) resolves as dead.
- [ ] A test proves `beginRunReconciliation` does not select a run whose owner is alive under the above rule; it fails against the current behaviour where a zone-skewed epoch orphans it.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — owner identity: what the epoch is derived from and why a mismatch is not proof of death.
- `v2/docs/operator-runbook.md` — Known gotchas: `sandbox-unrunnable` daemon tests false-red on a machine whose system zone is not UTC; re-run with the zone aligned before believing them.
