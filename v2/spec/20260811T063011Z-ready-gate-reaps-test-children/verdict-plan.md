## Verdict — refinements required

### 1. `maxBuffer` claim is false in group mode (01)

`shared/subprocess.ts` applies `maxBuffer` only on the `execFile` path; the process-group path ignores it. 01's checklist asserts the spawn keeps "`maxBuffer` … unchanged," which is unimplementable, and every cited preservation test uses a mock runner so nothing would catch the regression. The spec must drop `maxBuffer` from the preserved-options list and record an explicit decision on output capture: either accept unbounded capture for the gate (stating the risk) or require group mode to honor a cap. This is a factual defect, not a gap.

### 2. The `ReadyGate` signature decision is unstated and load-bearing (01)

`ReadyGate` is `(worktreePath, baseRef) => Promise<void>` and both default gates are closed over `runner` at `createReadyFinalizer` time; a per-invocation `signal`/recorder on `ReadyFinalizeInput` has no path into those closures. The spec must state which shape it takes — construction-time (seams carry signal + recorder into the closure) or call-time (widen the exported gate function types across ~25 construction sites) — because that choice determines the diff size and every downstream task. Silence here means the implementer picks the architecture.

### 3. The recorder cannot ride the stated seam (01)

`CompletionPublicationSeams` is a `Pick` of `WriteLoopInput`; `store` and `runId` are separate parameters of `publishWithReadyRepair`, not `WriteLoopInput` fields. The `signal` half of that decision is correct (`signal?: AbortSignal` is reachable via `WriteExecuteInput`); the recorder half is not. Correct the threading decision to describe a path that exists.

### 4. Aborting mid-gate changes the reachable classification (01)

Killing the group makes the child close on a signal, the runner rejects, and the gate's catch converts that into `ReadyGateError` — which `publishWithReadyRepair` treats as an active gate failure and answers with bounded agent repair. So a killed run can spawn repair iterations against a worktree the operator just terminated. "Classification untouched" is true of the code and false of the behavior. The spec must decide how an abort-caused gate rejection is distinguished from a real gate failure, and carry an acceptance criterion on the terminal status of a run killed mid-gate.

### 5. The daemon-loss/resume tail is named in the intent but unaddressed

The resume path builds its write-loop input with no `signal` and feeds `publishWithReadyRepair`. As drafted, every AC can tick while the intent's explicit "settles after daemon loss while the gate is mid-flight" scenario stays broken. Either wire a termination signal into that path or state a decision that it is covered only by the (deferred) recorded-pgid sweep — silence is not acceptable.

### 6. Split 01 into two independently testable subspecs

01 carries two separable behaviors: (a) both gate invocations spawn in group mode bound to the run's termination signal — the operator-visible leak fix, verified by the reap regression plus spawn-option tests; (b) the in-flight group id is recorded on the owning run and cleared on settlement — which needs 00's column and the seam widening. Split accordingly, keep 00's column adjacent to its only in-spec writer, carry every existing task and acceptance outcome exactly once across the replacements, and link each from `index.md`.

### 7. Narrow the doc updates; add the parity catalog

Four sibling spawns in the same neighborhood remain unbound (base-ref probe, diff-derived verifier, mutation-checkpoint verifier — signal but no group — and runtime smoke). Deleting the runbook's standing `pkill` sweep on a partial fix turns a known gotcha into a silent one: record what the gate now does, keep the standing sweep, and note the remaining unbound spawns. Add `v2/docs/v1-behaviors.md` to the documentation updates — this changes existing v2 gate behavior, which the repo requires be recorded in that catalog.

### 8. pgid uniqueness and staleness (00)

"A group id belongs to exactly one run" holds only in the write direction; a recycled pid means a future sweep's `kill(-pgid)` can hit an unrelated group. Since 00 freezes the schema, the spec must state a decision — either a recorded-at/start-time discriminator now, or an explicit deferral of staleness discrimination to the sweep's own migration. A decision suffices; do not add the column speculatively.

### 9. Checkpoint mechanics

- 00's Mutation and Keystone criteria name the same enclosing test title, so directive linking cannot distinguish them — split across two tests. Also, the proposed clear-path mutation (non-null constant) reddens the record assertion too, so it isolates nothing about clearing; pick a mutation that only the clear assertion catches.
- 01's guard checkpoints all pin the gate invocation. The required-integration invocation's `signal`, `processGroup`, and settlement clear carry no inverted-guard evidence, and the single-column interleaving (gate clears, integration then records) is unasserted. Pin them or state why not.
- The reap regression will race: group kill escalates on a short timer inside a load-sensitive integration slice. The criterion must specify poll-until-`ESRCH`-with-deadline semantics, and the fixture must be shaped to actually exercise escalation if that is what is being proven.

### Confirmed sound

Prerequisites hold; the three cited preservation tests exist at the named sites; `025` is the correct next migration id; the `v2-architecture.md` text targeted for replacement is real; the `processGroup`/`onGroupId` contract is as documented.