# Defer run-row process-group clear until the group is gone

Implement iterations record agent and snapshotted descendant pgids on the run row via `trackInvocationProcessGroups` / `storeVerifierProcessGroupRecorder` (`20261001T145916Z-implement-run-records-agent-process-groups`). Today `settle()` clears every recorded id when the binding promise resolves even if SIGKILL has not run or the group still has live members — reachable on main via `src/execution/write-loop-agent-process-groups.test.ts` `${cause} snapshot records distinct foreign descendant groups before signals and clears on settle`, which expects an empty row immediately after settle while only SIGTERM has been sent.

## Decision ledger

- `trackInvocationProcessGroups.settle` removes a pgid from the run row only after that process group is confirmed gone — rules out unconditional `recorder.clear` on invoke settle while `process.kill(-pgid, 0)` (or an injected test seam with the same meaning) still succeeds.
- A recorded pgid whose group is still alive when invoke settle runs stays on the run row until the group is confirmed gone — rules out clearing at settle to satisfy mid-iteration visibility tests when descendants remain (downstream daemon sweep and run-scoped kill rely on the row).
- Reuse the same group-liveness confirmation the no-survivors fix uses inside `singleSpawn`; do not add a second persistence writer — rules out a parallel recorder or daemon-side inference of live pgids.
- Late probe snapshots after settle must still not leave stale ids (`src/shared/invocation/agents.test.ts` test `a descendant snapshot resolving after invocation settle cannot leave stale recorded groups` stays green) — rules out deferring clear in a way that re-records post-settle snapshots onto the row.

## Out of scope

- Changing daemon startup sweep behavior (`20261002T141120Z-daemon-sweeps-recorded-agent-groups`); this subspec only fixes when invoke settlement clears ids.

## Task checklist

- [ ] Extend `trackInvocationProcessGroups` in `src/shared/invocation/agents.ts` so clear runs only after group-gone confirmation; keep record behavior unchanged.
- [ ] Add or extend a regression in `src/shared/invocation/agents.test.ts` or `src/execution/write-loop-agent-process-groups.test.ts` that leaves a snapshotted pgid alive at invoke settle and asserts it remains on `store.verifierProcessGroups(runId)` until gone, then clears.
- [ ] Adjust existing write-loop agent-group tests that assumed immediate clear on settle so they wait for group-gone confirmation (SIGKILL escalation or injected liveness seam) before expecting an empty row.
- [ ] Update `docs/shared-invocation.md` and `docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `src/shared/invocation/agents.test.ts` or `src/execution/write-loop-agent-process-groups.test.ts` asserts a recorded pgid whose group is still alive at invoke settle stays on the run row until that group is confirmed gone; fails against main if settle clears the id while descendants remain (reachable via `write-loop-agent-process-groups.test.ts` abort/timeout/stall snapshot tests expecting `recorded()` empty right after settle with only SIGTERM sent).
- [ ] `src/shared/invocation/agents.test.ts` test `a descendant snapshot resolving after invocation settle cannot leave stale recorded groups` stays green.
- [ ] `docs/shared-invocation.md` states idle-stall and abort group-kill semantics include the no-survivors invariant and deferred recorder clear timing aligned with production behavior.
- [ ] `docs/v1-behaviors.md` adds a `[harness behavior change]` entry for the no-survivors invariant and recorder-clear timing with sources `src/shared/invocation/agents.ts`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:agent` passes.

## Documentation updates

- `docs/shared-invocation.md` — idle-stall and abort kill semantics: no-survivors past `abortKillGraceMs`; run-row pgid clear only after group-gone confirmation.
- `docs/v1-behaviors.md` — `[harness behavior change]` entry for the invariant and recorder-clear timing.
