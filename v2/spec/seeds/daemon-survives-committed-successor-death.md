---
name: daemon-survives-committed-successor-death
---

# The daemon address survives a committed successor's death, and stage settlement respects a live foreign owner

## Problem

Two pre-existing defects produced a full outage and a false stage failure on 2026-09-17:

1. **No recovery after commit.** Self-handoff `commit` sets the transaction `committed` and clears the fallback timer; `rollback` on a committed transaction is a no-op (`v2/src/daemon/daemon.ts:917-948`), and `startDaemon` stops watching the successor once committed (`v2/src/daemon/daemon-lifecycle.ts:376-395`). If the committed successor then exits, nothing rebinds `~/.jarvis/daemon.sock`: every `jarvis` verb fails `connect ENOENT` and `daemon status` reads `stopped` while the outgoing generation is alive and still running work. The successor's exit was silent (drain-exit path, `daemon.ts:313`, `:1356-1360`, `:1557`) — no line names what told it to retire.
2. **Stage settlement ignores a live foreign owner.** On daemon start, `settleOrphanedRunningStages` (`v2/src/daemon/pipeline-execution.ts:1047`) settles through `stage-settlement-owner.ts:58-59` with local-only liveness; when the entry row is terminal but a sibling row (`~shrink`) is `in-progress` and owned by a live other daemon, the rollup runs with `isLive: false` (`v2/src/daemon/pipeline-stage-settlement.ts:247`), reads `killed` (`v2/src/persistence/workflow-run-status-rollup.ts:88-90`), and writes the stage `failed` / `resumable_kill` while the work continues.

## Evidence

2026-09-17: self-handoff at ~05:48 CDT from PID 46975 to 92099 (digest `c44a4f37` = #3982) committed; 92099 exited silently before 06:14 (no crash report, private socket removed cleanly); the public socket stayed absent until an operator `jarvis daemon start` at 06:24 (PID 7714). 46975 was still running the base-probe lane's agent. 7714's startup sweep then failed pipeline `293276f7` stage `implement` (`resumable_kill`, entry `killed`) while its `~shrink` row was `in-progress` and owned by live `46975:1789631083067`; no row was reconciled.

## Decisions

- A retiring outgoing generation watches its committed successor; if the successor's process dies or the public address stops answering, the outgoing generation rebinds the public address and reopens admission (the handoff is treated as failed, not re-attempted until the next digest sample).
- Every retire/drain/exit path logs its trigger (RPC name and caller, or signal) before acting, so a silent exit cannot recur undiagnosed.
- Stage settlement treats an invocation as live when any of its rows is non-terminal and owned by a live daemon (this one or another); only then may local liveness decide. Rules out settling a stage whose work another generation is still running.
- No change to how rows are reconciled.

## Acceptance criteria

- [ ] A daemon test commits a handoff, kills the successor, and asserts the public address answers again from the outgoing generation within a bounded time; it fails against the current code.
- [ ] A test asserts `supersede`/`changeover`/`shutdown` and signal-driven retire each write a daemon-log line naming the trigger before exiting.
- [ ] A test with an invocation whose entry row is `completed` and whose `~shrink` row is `in-progress` owned by a live foreign identity asserts the startup sweep leaves the stage `running`; it fails against the current code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — post-commit successor watch; trigger logging; foreign-owner liveness in stage settlement.
- `v2/docs/operator-runbook.md` § Daemon lifecycle — what an operator sees when a successor dies, and that `daemon start` is no longer required.
