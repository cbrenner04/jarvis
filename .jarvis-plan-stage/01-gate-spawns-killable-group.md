# 01 - Gate spawns in a killable group bound to run termination

Module boundary: execution (`v2/src/execution/ready-finalize.ts`, `v2/src/execution/write-loop.ts`).

`createDefaultRunReadyGate` calls `runner.runAsync("bun", ["run", "ready"], worktreePath, { maxBuffer, env })` with no `signal` and no `processGroup`, and `createDefaultRunRequiredIntegration` passes even less. Terminating a run (kill, abandon, iteration timeout, or settlement after daemon loss) unwinds the harness while the gate's `bun test` tree keeps running — observed surviving for days and starving the machine. This subspec binds both invocations to the run's termination signal in process-group mode and records the spawned group id on the owning run for the duration of the gate.

## Decisions

- Both the gate and the required-integration invocation opt into `processGroup` and carry the run signal — the integration step is a second `bun test` tree with the same leak, so exempting it would leave half the fix.
- The run's existing termination `AbortSignal` (`WriteLoopInput.signal`, aborted by the daemon's per-run `abortController` on kill/abandon) is the binding, not a new controller — a fresh controller would have to re-derive every termination path.
- The signal and the group-id recorder reach the gate by widening the `CompletionPublicationSeams` `Pick` and `ReadyFinalizeInput`/`ReadyFinalizerSeams`, not by giving `ready-finalize.ts` a state-store dependency — that module stays seam-driven and test-injectable.
- The recorder is called with the group id at spawn and with `null` in a `finally` covering both settlement paths, so a failed or throwing gate clears as reliably as a green one; leaving the id set on failure would make a live run look reapable.
- `runner.runAsync` group mode already escalates SIGTERM→SIGKILL on the group, so this subspec adds no killing logic of its own.
- Scope is the spawn options and the recorder: test selection, `JARVIS_READY_TEST_SCOPE` derivation, gate classification (`ReadyGateError`, timeout detection), and repair behavior are untouched.
- Deferred to first consumer: the sweep that reaps a recorded group whose run no longer exists — pin when a caller needs it.

## Task checklist

- [ ] Widen `ReadyFinalizeInput` with the run's `signal` and `ReadyFinalizerSeams` with the group-id recorder; thread both from `executeWriteLoop` through `publishWithReadyRepair`/`runReadyFinalizer`.
- [ ] Pass `signal` and `processGroup: { onGroupId }` in both `createDefaultRunReadyGate` and `createDefaultRunRequiredIntegration`, keeping command, args, cwd, `maxBuffer`, and `env` unchanged.
- [ ] Clear the recorded group id in a `finally` on both invocations.
- [ ] Default the recorder in the write loop to `store.setReadyGatePgid(runId, …)` (from `00`).
- [ ] New integration regression `v2/src/execution/write-loop-ready-gate-reap.sandbox-unrunnable.test.ts`: drive a run to a gate that spawns a real, long-lived child process group, abort the run's signal, and assert the group is gone.
- [ ] Unit tests in `v2/src/execution/ready-finalize.test.ts` asserting the spawn options (`signal`, `processGroup`) for both invocations and the record/clear sequence on success and failure.

## Acceptance criteria

- [ ] Terminating a run whose ready gate is mid-flight leaves no surviving test descendant: a new `v2/src/execution/write-loop-ready-gate-reap.sandbox-unrunnable.test.ts` drives a run to a gate spawning a real process group, aborts the run signal, and asserts the spawned group id no longer exists (`process.kill(-pgid, 0)` throws `ESRCH`); it fails against the pre-fix code, where the group survives the abort.
- [ ] The gate and the required-integration invocation each spawn in group mode bound to the run's termination signal, asserted from the spawn options captured by a mock `AsyncSubprocessRunner` in `v2/src/execution/ready-finalize.test.ts`.
- [ ] The in-flight group id is recorded for the owning run at spawn and cleared on settlement, on both the green and the failing gate paths, asserted in `v2/src/execution/ready-finalize.test.ts`.
- [ ] A gate that completes normally is unaffected: the existing `v2/src/execution/ready-finalize.test.ts` `createReadyFinalizer` tests stay green, including `runs the ready gate then flips the draft PR on green`, `overrides inherited JARVIS_READY_TIER=fast with full in the gate's child env`, `carries the ready gate command, exit code, and combined output`, and `runs required integration scope after ready gate and before flip`.
- [ ] Dropping the settlement clear turns the failure-path assertion red: replacing the `finally` clear call in the gate invocation with a no-op leaves the recorded id set after a failed gate. `v2/src/execution/ready-finalize.test.ts` — `clears the recorded ready-gate group id when the gate fails`; Mutation checkpoint: the clear's suppressed effect is proven absent by asserting the recorder's final value is `null`.
- [ ] Dropping the run signal turns the binding assertion red: replacing the gate's `signal` option with `undefined` leaves the gate unbound from run termination. `v2/src/execution/ready-finalize.test.ts` — `spawns the ready gate in group mode bound to the run signal`; Mutation checkpoint: the captured spawn options no longer carry the run's signal.
- [ ] Reverting the gate's spawn options to baseline (`{ maxBuffer, env }` — no `signal`, no `processGroup`) turns the reap regression red. `v2/src/execution/write-loop-ready-gate-reap.sandbox-unrunnable.test.ts` — `terminating a run mid-gate kills the ready gate process group`; Keystone checkpoint: a surviving revert means the group-mode spawn is inert.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — record that killed, abandoned, and timed-out runs reap their ready-gate test process tree; delete the "Leaked ready-gate `bun test` children peg CPU for days (2026-08-09)" known-gotcha bullet and its `pkill -9 -f "bun test"` standing rule.
- `v2/docs/v2-architecture.md` — replace "No caller opts in yet." in the process-group-kill note with the ready gate as the opting-in caller, recording its group id on the owning run.
