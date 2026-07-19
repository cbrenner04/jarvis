# Runtime-smoke gates implement completion

Wire the runtime-smoke verifier (subspec 00) into the implement completion path
as a mandatory boundary running after diff-derived mutation verification passes,
so mutation-caught tests alone can no longer certify completion. A failed or
timed-out smoke fails completion with the command and failed observation named;
a not-runnable result proceeds to `completed`.

## Decisions

- Run smoke verification in the shared completion boundary after mutation verification passes and before the draft→ready flip; rules out an optional review preset or operator convention as the last no-op defense, and rules out smoking a tree whose changed guards are not yet proven.
- Reuse the completion boundary's run base and worktree; rules out a second diff/base derivation that could diverge from mutation verification.
- A failed or timed-out smoke stops completion (run is not reported `completed`) naming the command and failed observation, mirroring surviving-mutation settlement; rules out hiding runtime evidence behind a generic red gate.
- A not-runnable smoke result proceeds to `completed`, recording inspected paths and reason; rules out blocking non-runnable completions on a missing entrypoint.
- Leave no smoke-execution side effects in the published tree; rules out publishing probe state.

## Task checklist

- Invoke the subspec 00 verifier in the completion boundary after `runMutationVerification` and before the flip, threading the boundary's run base and worktree.
- Classify a failed/timed-out smoke into a `runtime_smoke_failed` completion failure that keeps the run out of `completed` and names the command + observation.
- Pass a not-runnable result through to `completed`.
- Update the four durable docs listed below.

## Acceptance criteria

- [ ] Implement completion runs runtime-smoke verification as a mandatory boundary after diff-derived mutation verification passes and before the draft→ready flip; it is not an optional review preset that can be omitted.
- [ ] A failed or timed-out smoke fails completion: the run does not report `completed`, and the failure names the executed command and the failed observation.
- [ ] A completion whose changed runnable surface smokes cleanly, or that has no discovered runnable surface, proceeds to report `completed`.
- [ ] The runtime-smoke boundary reuses the completion boundary's run base and worktree rather than deriving its own.
- [ ] A new test drives the real completion path (injected finalize/smoke seams) to a non-`completed` outcome for a changed entrypoint whose smoke fails, asserting the run is not `completed` and the command and observation are named, and to `completed` for a clean or not-runnable smoke; it fails against the pre-fix path (completion certifies without a smoke) and passes after.
- [ ] `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` are updated per the Documentation updates section.

## Documentation updates

- `v2/docs/workflow-runner.md` — runtime-smoke ordering in the completion boundary and failure settlement.
- `v2/docs/write-behavior.md` — completion semantics: `completed` now requires runtime-smoke evidence in addition to mutation evidence.
- `v2/docs/operator-runbook.md` — delete the manual green-gate and mutation-review runtime-smoke stopgap.
- `v2/docs/v1-behaviors.md` — record the completed v2 adversarial verification guarantee (mutation + runtime smoke).
