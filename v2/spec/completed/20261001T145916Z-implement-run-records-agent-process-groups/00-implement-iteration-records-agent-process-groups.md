# Implement iteration records agent and snapshotted descendant groups on the run row

## Problem

Only verifier spawns record process groups on the run row (`recordVerifierProcessGroup` / `store.verifierProcessGroups`). Bounded implement-loop agent invocation and shell-tool descendant groups stay invisible to `jarvis run kill` and daemon orphan sweep even though abort/stall/timeout already snapshots and signals them.

## Decision ledger

- Bind the same run-row recorder used for verifier spawns (`storeVerifierProcessGroupRecorder`) into agent invocation via shared spawn/snapshot hooks — rules out a new persistence column or parallel recorder API on the run row.
- Shared `AgentRunOptions` accepts an optional `{ record, clear }` seam structurally matching v2 `VerifierProcessGroupRecorder`; v2 constructs `storeVerifierProcessGroupRecorder(store, runId)` on the bounded `awaitIteration` path and passes it through step/invoke threading — rules out importing v2 persistence types into `shared/` or constructing the recorder inside `buildWriteExecuteInput`.
- After the detached agent child has a pid, `record` the agent process group when `isForeignProcessGroup` passes; when `killProcessGroup` takes a descendant snapshot (abort, idle stall with `joinProcessOnIdleStall`, iteration-timeout abort, or any path that already arms group kill), `record` each distinct foreign snapshotted pgid not yet recorded; on invocation `settle`, `clear` every pgid recorded for that invocation — rules out recording only at kill time (no mid-iteration visibility) or never clearing on normal completion.
- Thread the recorder from bounded `awaitIteration` (`settlementPolicy === "bounded"`) through `executeWrite` / `runStep` / `sharedInvocationExtras` and `executeWithQuotaFallback` → binding `invoke` so production agent calls record — rules out wiring only inside `shared/invocation/agents.ts` without invoke forwarding or recording `finalization-repair` iterations (out of intent scope).
- Settlement clears every recorded id before resolving invocation; a snapshot resolving after settlement still signals groups but cannot add stale persisted ids. The focused production-path race test pins this ordering.

## Out of scope

- `awaitIteration` with `settlementPolicy === "finalization-repair"` (no run-row agent/descendant recording in this change).
- Daemon sweep logic (`signalRecordedVerifierProcessGroups` already iterates `verifierProcessGroups`; confirm-only work stays in `ready-intents/daemon-sweeps-recorded-agent-groups.md`).
- Changing kill/snapshot semantics in `killProcessGroup` (prerequisite spec `20261001T023250Z-agent-abort-reaps-descendant-groups`).

## Task checklist

- [x] Add optional process-group recorder to `AgentRunOptions` and `pickAgentRunOptions`; implement record-at-spawn, record-on-snapshot, clear-on-settle in `singleSpawn` (`shared/invocation/agents.ts`).
- [x] Forward the recorder through `shared/invocation/execute.ts` (`executeWithQuotaFallback` → binding `invoke`) via the same `pickAgentRunOptions` path as idle stall and related fields.
- [x] Extend `StepRunInput` / `sharedInvocationExtras` and `WriteExecuteInput` to carry an optional recorder; in `awaitIteration` when `settlementPolicy === "bounded"`, construct `storeVerifierProcessGroupRecorder(store, runId)` and pass it into `executeWrite` (`v2/src/execution/step-runner.ts`, `v2/src/execution/write.ts`, `v2/src/execution/write-loop.ts`).
- [x] Add integration tests in a new `v2/src/execution/write-loop-agent-process-groups.test.ts` (not `write-loop.test.ts`, which is over budget pending its split) that drive the production step → `executeWithQuotaFallback` → invoke path (real bindings; injectable spawn / probe / group-kill seams only where `shared/invocation/agents.test.ts` does) against a real `StateStore` run row — not a mock that skips invoke forwarding.
- [x] Update operator docs, v1 parity catalog, and stale module comments on the recorder helper.

## Acceptance criteria

- [x] `v2/src/execution/write-loop-agent-process-groups.test.ts`: a bounded implement iteration records the agent pgid on the run row (`store.verifierProcessGroups(runId)`) while the agent invocation is in flight and clears it after the iteration settles, via the production step → invoke path; fails against pre-fix (empty).
- [x] `v2/src/execution/write-loop-agent-process-groups.test.ts`: after a snapshotted descendant group exists on the abort/stall/timeout snapshot path, that foreign pgid is recorded on the run row and cleared on settle on the same production path; fails against pre-fix (agent pgid only or empty).
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — bounded implement-loop agent invocation records the agent process group and each foreign snapshotted descendant group on the run row for `run kill` and daemon sweep, using the same verifier process-group recorder as finalization spawns; clear on invocation settle.
- `v2/docs/v1-behaviors.md` — **[v2 additive]** entry: implement iterations record agent and snapshotted shell-tool descendant process groups on the run row (same `recordVerifierProcessGroup` store as verifier spawns); v1 recorded only the agent subprocess group at watchdog time, not durable run-row ids for kill/sweep.
- `v2/src/execution/verifier-process-groups.ts` — module comment covers implement-loop agent and snapshotted descendant recording, not finalization verifier spawns only.
