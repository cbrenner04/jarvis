# Record implement agent and snapshotted descendant groups on the run row

## Problem

Finalization verifier spawns record detached process groups on the run row (`run_verifier_process_groups` via `storeVerifierProcessGroupRecorder`), so `jarvis run kill` and daemon orphan sweep signal them. Implement agent invocations (`shared/invocation/agents.ts` `singleSpawn`) do not, so the agent group and shell-tool descendant groups stay invisible to those paths even though abort, idle stall, and iteration timeout already snapshot and signal them.

## Decision ledger

- Reuse `storeVerifierProcessGroupRecorder` and `run_verifier_process_groups`; rules out a new column or parallel persistence shape for agent groups.
- Define optional run-row recorder hooks (`record` / `clear` per pgid) in `shared/**` (same seam family as `probeAgentDescendantProcessGroups` / `isForeignProcessGroup`); v2 adapts `storeVerifierProcessGroupRecorder` only at the `write-loop` thread-in; rules out `shared/**` importing v2 for the recorder shape.
- Bind recording in `singleSpawn` through those hooks (`record` at agent spawn, `record` for each foreign `pgid` when `killProcessGroup` takes or reuses a descendant snapshot, `clear` per id on invocation settle); rules out v2-only spawn wrappers that bypass `agents.ts`.
- Apply shared `isForeignProcessGroup` before every `record`, matching `trackProcessGroup`; rules out recording the harness's own group id.
- `clear` on settle must not run until every foreign pgid from the kill-path snapshot is `record`ed (await probe inside `killProcessGroup`, record synchronously from cached `snapshottedProcessGroups`, or defer settle `clear` until async records finish); rules out synchronous settle `clear` racing the fire-and-forget descendant probe on abort/stall/timeout.
- Thread the recorder from `write-loop.ts` only for `implement.prompt.body` iterations (`buildWriteExecuteInput` → `executeWrite` → step runner → `executeWithQuotaFallback` → binding `invoke` args); rules out recording plan, intent, shrink, gate-repair, or workflow-review agent calls on the same run row slot.
- Track every `record`ed pgid inside `singleSpawn` so settle clears each id even when the kill path recorded extra descendant groups; rules out leaving snapshotted ids on the row after a normal ok completion.
- SIGKILL escalation timers stay independent of settle (prerequisite behavior); rules out tying recorder `clear` to abort grace completion.

## Out of scope

- Daemon or kill-handler changes (they already read `verifierProcessGroups`).
- Recording for non-implement write prompts or verifier spawns (unchanged).

## Task checklist

- [ ] Add optional run-row process-group recorder hooks to shared invocation invoke args and `AgentRunOptions`; extend `pickAgentRunOptions` and every binding `invoke` that already spreads `pickAgentRunOptions` (claude/codex/cursor) plus opencode so implement recorder hooks reach `singleSpawn`.
- [ ] In `singleSpawn`, `record` the agent pgid after spawn when foreign; on `killProcessGroup` snapshot, `record` each distinct foreign snapshotted pgid not already recorded; on settle, `clear` every pgid recorded during that invocation without racing async snapshot `record` (per ledger ordering).
- [ ] Thread optional recorder through `executeWithQuotaFallback`, `sharedInvocationExtras` / `WriteExecuteInput`, and `buildWriteExecuteInput` with `storeVerifierProcessGroupRecorder(store, runId)` when `args.promptId === "implement.prompt.body"`.
- [ ] Add `v2/src/execution/write-loop.test.ts` regressions: agent pgid while running; and abort/stall/timeout via production `killProcessGroup` with injected `probeAgentDescendantProcessGroups` returning a foreign pgid (not a test that only calls `record` on a mock).
- [ ] Update operator-facing docs and v1 parity catalog (concrete catalog line per Documentation updates).

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts`: an implement iteration records the agent pgid on the run row (`store.verifierProcessGroups(runId)`) while the agent invocation is in flight and clears it on settle; fails against pre-fix (empty).
- [ ] `v2/src/execution/write-loop.test.ts`: drives abort, idle stall, or iteration timeout through production `killProcessGroup` with injected `probeAgentDescendantProcessGroups` returning a foreign pgid so that pgid appears on the run row during the kill path and clears on settle; fails against pre-fix (agent pgid only or empty).
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — run rows record the implement agent group and snapshotted foreign descendant groups for kill and sweep, same as verifier groups.
- `v2/docs/v1-behaviors.md` — extend the durable run-row process-groups catalog bullet (~line 645): v2 also records each `implement.prompt.body` agent pgid and foreign snapshotted descendant pgid on `run_verifier_process_groups` until that invocation settles (same kill/sweep surface as verifier spawns); v1 had no equivalent durable table (patch mode signaled only the in-flight agent group).
