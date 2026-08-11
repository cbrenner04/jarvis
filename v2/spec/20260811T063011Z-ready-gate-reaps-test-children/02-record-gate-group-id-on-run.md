# 02 - Record the in-flight ready-gate group id on the owning run

Module boundary: execution (`v2/src/execution/ready-finalize.ts`, `v2/src/execution/write-loop.ts`).

Depends on `00` (the `ready_gate_pgid` column and `setReadyGatePgid`) and `01` (both invocations already spawn in `processGroup` mode, giving each a group id to record). This subspec wires that group id onto the owning run for the duration of the gate, so a future sweep can find a group whose run no longer exists. It does not build that sweep.

## Decisions

- The recorder does not ride `CompletionPublicationSeams` or `WriteLoopInput`: `CompletionPublicationSeams` is a `Pick` of `WriteLoopInput`, and `store`/`runId` are separate parameters of `publishWithReadyRepair`, not `WriteLoopInput` fields, so there is no existing field to widen onto. Instead, `publishCompletionArtifacts` and `runReadyFinalizer` each gain an explicit optional parameter — `onGateGroupId?: (pgid: number | null) => void` — passed alongside `seams`/`input`. `publishWithReadyRepair` builds this closure itself, since it already has both `store` and `result.runId` in scope: `(pgid) => store.setReadyGatePgid(result.runId, pgid)`.
- `ReadyFinalizeInput` gains `onGateGroupId?: (pgid: number | null) => void`. The finalizer returned by `createReadyFinalizer` passes it to both `runReadyGate` and `runRequiredIntegration` as `options.onGroupId` (same options object `01` introduced alongside `signal`).
- Recording and clearing happen per invocation, not once for the whole gate: the default gate records the group id at spawn (`processGroup: { onGroupId: (pgid) => options?.onGroupId?.(pgid) }`) and clears it (`options?.onGroupId?.(null)`) in a `finally` covering both its success and failure paths; the default required-integration runner does the same independently. Only one of the two is ever in flight, so the column correctly holds the gate's id, then goes through a `null` gap, then the integration's id, then `null` again — this interleaving is asserted directly rather than assumed.
- Clearing in `finally` means a failed or throwing invocation clears as reliably as a green one — leaving the id set on failure would make a live, still-repairing run look reapable by a future sweep.
- The daemon-loss/resume tail named in the intent ("settles after daemon loss while the gate is mid-flight") is **not** fixed by a live signal: once the daemon process itself is gone, there is no `AbortController` left to fire, so `01`'s signal binding cannot reach that gate. `reconcileOrphanedRuns` already marks the orphaned run row `killed`/`interrupted` on daemon restart, but has no way to touch the now-parentless process group. This subspec's durable `ready_gate_pgid`, still recorded on that run row at the moment of daemon loss, is exactly what lets a future sweep identify and reap that group after the fact — that sweep is deferred (first-consumer, per `00`), but this subspec is what makes it possible. No signal-wiring work belongs in this subspec for the daemon-loss case.
- Scope is the recorder threading and its record/clear lifecycle: gate/required-integration spawn options (`01`), test selection, scope derivation, and repair behavior are untouched.

## Task checklist

- [ ] Add `onGateGroupId?: (pgid: number | null) => void` to `ReadyFinalizeInput`; thread it into both invocations' `options.onGroupId`/`finally` clear.
- [ ] Add an optional `onGateGroupId` parameter to `publishCompletionArtifacts` and `runReadyFinalizer`, passed through to `readyFinalizer(finalInput)`.
- [ ] In `publishWithReadyRepair`, build `(pgid) => store.setReadyGatePgid(result.runId, pgid)` and pass it to `publishCompletionArtifacts`.
- [ ] Unit tests in `v2/src/execution/ready-finalize.test.ts` asserting record/clear on both invocations, on both the green and the failing gate paths, and the gate-clears-then-integration-records interleaving.

## Acceptance criteria

- [ ] The in-flight group id is recorded for the owning run at spawn and cleared on settlement, on both the green and the failing gate paths, asserted in `v2/src/execution/ready-finalize.test.ts`; it fails against the pre-fix code, where no recorder is ever invoked.
- [ ] The required-integration invocation records and clears its own group id independently of the gate's, asserted in `v2/src/execution/ready-finalize.test.ts` by driving a finalizer through gate success into required integration and observing the recorder receive: gate pgid, `null`, integration pgid, `null` — in that order.
- [ ] A gate that completes normally is unaffected: the existing `v2/src/execution/ready-finalize.test.ts` `createReadyFinalizer` tests stay green, including `runs the ready gate then flips the draft PR on green`, `overrides inherited JARVIS_READY_TIER=fast with full in the gate's child env`, `carries the ready gate command, exit code, and combined output`, and `runs required integration scope after ready gate and before flip`.
- [ ] Dropping the settlement clear on the gate turns the failure-path assertion red: replacing the gate's `finally` clear call with a no-op leaves the recorded id set after a failed gate, while the required-integration recorder (never reached on a failing gate) is unaffected. `v2/src/execution/ready-finalize.test.ts` — `clears the recorded ready-gate group id when the gate fails`; Mutation checkpoint: the clear's suppressed effect is proven absent by asserting the recorder's final captured value is the gate's pgid, not `null`.
- [ ] Dropping the settlement clear on the required-integration invocation turns its own assertion red, independent of the gate's. `v2/src/execution/ready-finalize.test.ts` — `clears the recorded group id when required integration fails`; Mutation checkpoint: replacing the required-integration invocation's `finally` clear with a no-op leaves that invocation's id set, while the gate checkpoint above stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — note that `ready_gate_pgid` is written by the ready-finalize gate and required-integration invocations (`01`/`02`), not just by the schema in `00`.
- `v2/docs/v1-behaviors.md` — record that a run durably carries its in-flight ready-gate/required-integration process group id, cleared on settlement, and that this is what makes a future daemon-loss reap sweep possible.
