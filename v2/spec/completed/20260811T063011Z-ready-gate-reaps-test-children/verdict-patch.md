## Verdict — refinements required

### 1. The reap regression's keystone `@mutate` directive is dead (must fix)

`v2/src/execution/write-loop-ready-gate-reap.sandbox-unrunnable.test.ts:33` pins the source text `{ env, signal: options?.signal, processGroup: {} }`, which no longer exists in `v2/src/execution/ready-finalize.ts` — subspec `02` renamed the gate's options parameter and hoisted `processGroup` into a local. `01`'s keystone acceptance criterion ("reverting the gate's spawn options to baseline turns the reap regression red") is ticked with a checkpoint that cannot resolve, so nothing verifies that the group-mode spawn is load-bearing. **Required outcome:** every `@mutate` directive introduced on this branch resolves against current source, and the reap keystone in particular pins the live gate spawn call. Sweep the branch's directives, not just this one.

### 2. The reap regression does not exercise the production abort path, and can orphan an unkillable process (must fix)

The test aborts the run signal from inside `onGroupId`, which the shared runner fires synchronously in the same tick as `spawn()`. The runner therefore takes its `signal.aborted` pre-check branch instead of the `addEventListener("abort", …)` path production actually uses, and the fixture shell has not yet installed `trap '' TERM` — so the SIGKILL escalation the criterion explicitly claims to exercise is never reached. Separately, the fixture is an unbounded `while true; do sleep 1; done` that ignores SIGTERM and neither invocation sets a spawn timeout; under the keystone mutation (baseline spawn, no signal/group) the gate never settles, the test's own timeout cuts the body before its cleanup, and a SIGTERM-immune loop is left running on the operator's machine — precisely the failure class this spec exists to eliminate. **Required outcomes:** (a) the abort fires after the fixture is demonstrably trap-installed and the runner's abort *listener* path is the one taken, so SIGKILL escalation is genuinely proven; (b) no code path of this test — including its own failure and timeout paths, and mutation-verification runs of its checkpoint — can leave a surviving process. Bound the fixture's lifetime and/or the spawn.

### 3. The durable store wiring is unasserted (must fix)

`store.setReadyGatePgid` is called at exactly one production site (`v2/src/execution/write-loop.ts:3200`) and no test asserts the effect: deleting that line, or recording under the wrong run id, leaves every test green. `02`'s criteria only demanded seam-level recorder assertions, so the implementation is spec-compliant, but the intent's "records the gate's process group id durably **for the owning run**" is unpinned. **Required outcome:** a test proves the in-flight group id lands on (and is cleared from) the owning run's durable row. The reap regression already opens a real state store and drives a real run, so this is cheap there.

### 4. Documentation overstates the coverage (must fix)

Three overstatements, each contradicted by the branch's own code or decisions:

- `v2/docs/v1-behaviors.md` says kill, abandon, **iteration timeout, or settlement after daemon loss** signal the group, then four sentences later correctly says a live `AbortSignal` cannot reach the daemon-loss case — and `02`'s decisions state daemon loss is explicitly *not* fixed here. Nothing aborts the run controller on iteration timeout either. `v2/docs/operator-runbook.md` repeats "killed, abandoned, or timed-out."
- The `ready_gate_pgid` recording claim is unqualified, but the recorder reaches only the first publish; the autofix republish and every repair-loop republish go through `publishCompletionArtifacts(args, input)` with no recorder (`write-loop.ts:2935`). Note that the *signal* does flow to those re-gates, so repair gates are still reaped — only the durable id is missing.

**Required outcome:** the docs describe exactly what the code does. Either thread the recorder through the repair/autofix republish path so the claim becomes true, or narrow the claim to the first gate; and narrow the termination claim to the cases actually bound to the run signal.

### 5. `write-behavior.md` is the durable home for the new repair-entry condition (must fix)

`v2/docs/write-behavior.md` documents when a red gate enters autofix and bounded repair, and still states that unconditionally. This branch adds a real exception: an already-aborted run signal short-circuits before autofix and repair while still classifying `ready_gate_failed`. Per `v2/docs/documentation-standard.md` the durable home must be updated in the same subspec, regardless of `01`'s Documentation-updates list. **Required outcome:** one sentence there recording the abort short-circuit.

### 6. Recorder callbacks must not be able to unbind or misclassify the spawn (should fix)

The shared runner invokes `onGroupId` synchronously right after `spawn()` and ~30 lines *before* registering the abort listener. A throw from the recorder (e.g. a closed SQLite handle) rejects with the child already spawned and never bound to the signal — a permanently orphaned group, the exact bug being fixed. The symmetric throw from the settlement clear replaces an in-flight `ReadyGateError` and gets mapped to `ready_flip_failed`, the misattribution `01` set out to prevent. **Required outcome:** a recorder failure cannot leave a spawned group unbound or convert a gate failure into a flip failure. The existing wrapper closures in `ready-finalize.ts` are the natural place.

### 7. The abort short-circuit test's agent assertion is vacuous (should fix)

`v2/src/execution/write-loop.test.ts` drives that test with `maxIterations: 0`, so the repair loop exits on budget regardless of the new guard and `expect(agentInvocations).toBe(0)` proves nothing — the criterion's "the agent runner is never invoked" is unearned. The autofix assertion *does* distinguish guarded from unguarded, so the checkpoint itself is live. **Required outcome:** the test's iteration budget permits at least one repair iteration, so the no-agent-iteration assertion is what the guard is actually holding up.

### Not upheld

- **Dropping `maxBuffer`.** Unbounded output capture in group mode was explicitly decided in `01` after the plan verdict forced the choice; capping the shared runner is outside the module boundary. A follow-up seed against `shared/subprocess.ts` is the right channel, not a change here.
- **Abort arriving after the guard passes.** Real but strictly narrower than pre-fix behavior; `01` committed only to the single post-classification guard, and the write-loop caller still routes the result through the aborted-signal branch. Follow-up.
- **`Run.readyGatePgid` optional-plus-nullable shape, the `mapRunRow` directive anchor, and the two near-identical invocation bodies.** The field shape matches every sibling nullable run field; the two bodies each carry their own independent mutation checkpoint, which is the drift guard; extracting a helper would widen a deliberately bounded diff.