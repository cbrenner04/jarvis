# 01 — Handoff settlement retire triggers log their trigger

Split from [00](00-retire-trigger-logging.md) (see its path inventory) to keep each subspec independently reviewable. Covers the handoff-settlement sites in `createHandoffHandlers` (`v2/src/daemon/daemon.ts`): the `handoff_commit`/`handoff_rollback` RPCs and the fallback timer's liveness-probe-driven resolution (`resolveFallback`).

## Decisions

- `changeover`, the handoff's entry point, is covered by [00](00-retire-trigger-logging.md), not here; every handoff-settlement call happens only after a `changeover` already created the pending transaction, so 00's `JARVIS_DAEMON_DRAIN_EXIT:` first-trigger capture needs no change here.
- `handoff_commit`/`handoff_rollback` RPCs: log at handler entry once the frame's `handoffId` matches the active transaction (past the identity-mismatch guard), before calling `commit`/`rollback`. A mismatched `handoffId` is a no-op and does not log.
- Fallback timer resolution (`resolveFallback`): log once it proceeds past its pending/closed guards, after the health-probe verdict (`fallbackVerdict`) is computed, before calling `commit`/`rollback`.
- Same log sink and line format as 00: `JARVIS_DAEMON_RETIRE_TRIGGER:` followed by `JSON.stringify({ trigger, ...rest })`. `trigger` is `handoff_commit`/`handoff_rollback` for the RPCs; `handoff_fallback` for the timer, carrying an additional `resolution: "commit" | "rollback"` field with the computed verdict — there is no RPC caller to name for a timer-driven trigger.
- Caller identity: `handoff_commit`/`handoff_rollback` frames carry only `handoffId` (a transaction id, not a caller identity) — same deferral as 00. The line names the RPC/timer only.
- A repeated call (e.g. a replayed `handoff_commit` against an already-committed transaction) still logs; no dedup, same as 00.
- Logging only; handoff settlement behavior (commit/rollback/fallback outcome, admission reopening) unchanged.
- No `v2/docs/v1-behaviors.md` update: net-new logging, not a change to existing behavior.

## Acceptance criteria

- [x] A test in `v2/src/daemon/` asserts `handoff_commit`, `handoff_rollback`, and the fallback-timer resolution — both a live-probe commit outcome and a dead-probe rollback outcome — each write a `JARVIS_DAEMON_RETIRE_TRIGGER:` line naming that trigger before the settlement acts; it fails against the pre-fix code.
- [x] `daemon-changeover.sandbox-unrunnable.test.ts` stays green (handoff settlement behavior unchanged).
- [x] `daemon-changeover-handler.test.ts` stays green (changeover handler behavior unchanged).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § "Daemon retirement on supersession" — document the handoff-settlement trigger lines (`handoff_commit`/`handoff_rollback`/`handoff_fallback`) alongside 00's.
