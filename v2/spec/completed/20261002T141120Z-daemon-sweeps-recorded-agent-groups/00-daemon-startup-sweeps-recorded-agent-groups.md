# Daemon startup sweep signals recorded agent process groups

After daemon loss, a killed implement iteration can leave agent (and snapshotted shell-tool descendant) process groups on the run row while the prior owner identity is dead. Operator expectation: the existing pre-IPC orphan sweep reaches those ids, same as ready-gate and finalization verifier recordings — not a second sweep.

Depends on implement iterations recording agent and snapshotted descendant pgids on `run_verifier_process_groups` (`20261001T145916Z-implement-run-records-agent-process-groups`) and abort/stall/timeout snapshot kill semantics (`20261001T023250Z-agent-abort-reaps-descendant-groups`).

## Decisions

- Orphan startup reap stays one path: `sweepOrphanReadyGateGroups` over `listReadyGateSweepCandidates` (every child-table pgid for runs whose `owner_identity` is absent or not alive); rules out a parallel agent-only sweep or calling `signalRecordedVerifierProcessGroups` at daemon start (`signalRecordedVerifierProcessGroups` remains for live `run kill` and related run-scoped signalling only).
- Implement production changes in `v2/src/daemon/daemon.ts` (or store listing) only when the new regression test fails on the merge-base; if the child-table sweep already signals agent-recorded ids, land test + docs + inline/doc-string alignment; rules out speculative daemon edits when behavior is already correct.
- Regression fixture models daemon loss mid implement iteration: seed through the production recorder `storeVerifierProcessGroupRecorder(store, runId).record(pgid)` (`v2/src/execution/verifier-process-groups.ts`, the recorder implement iterations use) — not `store.recordVerifierProcessGroup` directly — for the agent (and optionally a second recorded descendant) pgid(s) with no `setReadyGatePgid`, prior dead `owner_identity`, drive `sweepOrphanReadyGateGroups` (same helper `startDaemonRuntime` uses pre-IPC); rules out extending only the existing mixed ready-gate + verifier test without an agent-only dead-owner row (reachable gap when iteration timeout leaves agent ids on the row but no gate slot).

## Task checklist

- [x] Read `sweepOrphanReadyGateGroups`, `listReadyGateSweepCandidates`, and `signalRecordedVerifierProcessGroups`; confirm dead-owner rows sweep every `store.verifierProcessGroups` id without a second path.
- [x] Add or extend `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` for the agent-only dead-owner scenario (SIGTERM then SIGKILL per pgid, per-id clear).
- [x] If the regression test fails, fix `v2/src/daemon/daemon.ts` (or store listing) so agent recordings are swept; keep a single sweep entrypoint.
- [x] Replace finalization-only orphan-reap / recorded-group wording in `v2/docs/operator-runbook.md` and `v2/docs/daemon-host.md`; align `sweepOrphanReadyGateGroups` and related listing/sweep comments with the operator contract.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` adds a regression that seeds, via `storeVerifierProcessGroupRecorder(store, runId).record(pgid)`, a dead-owner run row with only implement-iteration agent (and optionally snapshotted descendant) pgid(s) on `run_verifier_process_groups`, drives `sweepOrphanReadyGateGroups`, and asserts SIGTERM→SIGKILL per id and per-id clear; pins agent-only dead-owner reachability when listing and sweep stay general (may pass on merge-base without production changes); fails if orphan listing or startup sweep omits child-table agent pgids for dead-owner runs.
- [x] `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` tests `sweeps a ready-gate pgid when the owning run owner is dead` and `sweeps every recorded verifier group for a dead-owner run, not only the ready-gate group` stay green.
- [x] `v2/docs/operator-runbook.md` and `v2/docs/daemon-host.md` contain no operator-visible text that limits daemon-start orphan reap or recorded process groups to finalization verifier spawns only; runbook states orphan reap covers every recorded pgid on the run row, including the implement-iteration agent tree and snapshotted shell-tool descendants; a leaked `bun test` (or other jarvis-owned test tree) after iteration timeout or daemon loss is a bug to fix, not expected operator cleanup.
- [x] `sweepOrphanReadyGateGroups` and related orphan listing/sweep comments in `v2/src/daemon/daemon.ts` (and store helpers they document) describe every recorded process group on the run row, not finalization verifier spawns only.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — correct finalization-only orphan-reap / recorded-group paragraphs; state implement-iteration agent tree coverage and leaked-test-after-timeout/daemon-loss as bugs (see acceptance criterion).
- `v2/docs/daemon-host.md` — same semantic alignment for daemon-start sweep and recorded groups (see acceptance criterion).
- `v2/src/daemon/daemon.ts` — `sweepOrphanReadyGateGroups` (and related) comments aligned with the operator contract when still finalization-only (see acceptance criterion).
