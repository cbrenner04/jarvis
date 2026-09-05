---
name: bind-verifier-spawns-to-run-termination
---

# Three verifier subprocess spawns outlive their run, and nothing reaps them

## Problem

Only the ready-gate spawn is bound to run termination. `ready-finalize.ts` threads an `onGateGroupId` callback that records the gate's process group as `ready_gate_pgid`, and daemon startup sweeps it (`daemon.ts:215` → `listReadyGateSweepCandidates` → `signalReadyGateProcessGroup`). That path shipped as #3431.

Three sibling spawns from the same finalization tail record nothing and are signalled by nothing:

- the base-ref reproduction probe (`createDefaultReproduceReadyGateAtBaseRef`, `ready-finalize.ts:435`)
- the diff-derived mutation verifier's scoped `bun test` children (`diff-derived-mutation-verifier.ts`, via `realAsyncSubprocessRunner.runAsync`)
- the runtime smoke verifier (`runtime-smoke-verifier.ts:85`, `bun run <entrypoint>`)

Each can spawn a `bun test` that itself forks up to 20 pool workers. When the owning run is killed, times out, or its daemon dies, those children keep running: no `pgid` was recorded, so neither the live termination path nor the startup sweep can find them.

## Evidence

This is the machine's most expensive recurring failure mode, and it has produced wrong diagnoses three sessions running:

- 2026-09-03 — eleven `bun test --test-worker` processes at ~96% CPU aged 24–62 minutes, load 20 with **one** live run, manufacturing five implement `iteration_timeout`s that read exactly like a concurrency ceiling. The root was a 3h35m-old orphan re-spawning `--only-failures` cohorts.
- 2026-09-04 — the brief retracts a "six concurrent implements is a zero-output ceiling" claim: the lane count was never measured cleanly because each timeout leaked more workers.
- 2026-09-05 — leaked workers corrupted a `test:v1` comparison, producing a "pre-existing on main" conclusion that CI then contradicted.

The operator runbook already carries a standing rule — "never tolerate these; a single day-old orphan is one too many, and three is a hard stop" — with a manual `pkill` recovery, and cites a seed `reap-ready-gate-test-children-on-run-termination` that **no longer exists**: it was reaped when #3431 landed the gate-group half. The remaining three spawns have had no seed, ready-intent, or issue since.

## Decisions

- Each of the three spawns records its process group the same way the ready gate does, so both the live run-termination path and the daemon-startup sweep can signal it. Rules out a new reaping mechanism — the `ready_gate_pgid` + `listReadyGateSweepCandidates` + `signalReadyGateProcessGroup` path already exists and should be generalized rather than duplicated.
- Durable storage is keyed so one run can carry several groups; a run runs these verifiers in sequence and may hold more than one at a time. Rules out overwriting a single `ready_gate_pgid` column and silently losing the earlier group.
- Sweeping stays keyed to "the owning run is not live", matching the current gate contract. Rules out age-based reaping — the 2026-09-03 incident proves minutes-old workers are as damaging as day-old ones, and age was the heuristic that missed them.
- Signalling remains SIGTERM→SIGKILL against the group, unchanged. Rules out per-PID walking, which the same incident showed loses re-spawned cohorts.

## Acceptance criteria

- [ ] A `ready-finalize.test.ts` regression proves the base-ref reproduction probe's process group is recorded on the run row; it fails against the current path where only the gate group is recorded.
- [ ] A `diff-derived-mutation-verifier.test.ts` regression proves the scoped verifier `bun test` spawn records its process group; it fails against the current unrecorded spawn.
- [ ] A `runtime-smoke-verifier.test.ts` regression proves the smoke probe spawn records its process group; it fails against the current unrecorded spawn.
- [ ] A state-store test proves a single run can carry multiple recorded verifier groups and that all of them are returned as sweep candidates when the run is not live; it fails against single-column storage.
- [ ] A daemon-startup test proves every recorded group for a non-live run is signalled, not just the ready-gate group.
- [ ] Terminating a live run signals the verifier groups recorded so far, proven by a test that fails when only the gate group is signalled.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the leaked-`bun test` gotcha states that all four spawns are bound, and drops the reference to the reaped `reap-ready-gate-test-children-on-run-termination` seed. Keep the diagnostic recipes (attribute by CPU and parentage, not age); they stay useful for operator-launched background runs, which remain out of scope.
- `v2/docs/write-behavior.md` — the finalization tail records a process group per verifier spawn.

## Sequencing

**P1.** Not a correctness bug in shipped code, but it is the single largest source of false diagnoses on this machine: it manufactures `iteration_timeout`s, corrupts every concurrency measurement taken while it is active, and has cost three sessions a wrong conclusion. The mechanism to copy already exists and is small.

Out of scope: operator-launched background test runs, which no run owns and which the runbook already covers by hand.
