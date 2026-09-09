# 01 - Gate-invocation budget and settlement

## Primary implementation surface

execution-loop — gate-invocation budget preflight, cross-lane serialization, `iteration_timeout` / `gate_invocation_refused` settlement, gate-only resumability, and downstream operator projection in `v2/src/execution/write-loop.ts`

Depends on [00 - Agent gate shell observability](./00-agent-gate-shell-observability.md).

## Problem

With the shell observability seam in place, implement lanes still invoke full-suite `bun run test:*` without ceiling headroom reservation, cross-lane serialization, or gate-only-outstanding resume — so concurrent lanes die at ~45m with only the gate AC unticked and settle non-resumable.

## Decision ledger

- **Budget reservation:** before starting a classified gate invocation, reserve `TEST_STEP_BUDGET_MS` (`scripts/ready.ts`, 15 minutes) against remaining `iterationCeilingMs` headroom elapsed since `iteration_started`; refuse when headroom is insufficient; active gate time accrues against the iteration ceiling timer, not the re-arming wall segment alone; rules out discovering overrun only as a mid-ceiling kill.
- **Serialization cap:** `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1` in `write-loop.ts` — an in-process, non-blocking `tryAcquire`/`release` slot, not a queueing semaphore like `MAX_CONCURRENT_VERIFIER_TEST_RUNS`; rules out reusing the verifier's queueing shape: that cap gates *our own* `bun test` spawn before it starts, but the agent's Bash call is already executing by the time `onAgentShellCommand` fires (the CLI announces/runs its own tool call regardless of what our callback does), so queuing a second lane would let its suite keep running the whole wait — it would not actually delay the agent's subprocess and defeats the point of serializing.
- **Slot acquire/lose:** on a classified gate callback, try to acquire the sole slot; already held by another lane → treat exactly like insufficient headroom (see settlement shape below): abort the invocation now rather than let two suites run concurrently for the compute-bound work ahead; rules out a "wait and see" path, which cannot un-start a Bash call that already began.
- **Slot release:** on gate shell-tool completion frame (or iteration loss abort), not at iteration/loop settle; rules out holding the machine-wide slot for the remainder of a 45-minute iteration after the suite finishes.
- **Gate-criterion identification:** scan each non-human-only acceptance criterion's text for backtick-delimited command tokens; a criterion is a gate criterion when any token matches `isReadyTestCommand` (including bare `bun run test`); prose mentions without backticks do not qualify; human-only gate criteria are ignored for resumability; rules out treating typecheck or file-scoped test ACs as gate criteria and rules out `ci-test-scope.ts` script-name literals without `bun run` prefix.
- **Active subspec for resumability:** the subspec at implement `expectedArtifactPath` (`patch.prompt.body` routing in `write.ts`); rules out `hasCompletedSubspec` / sibling-complete inventory as the gate-only resume gate.
- **`gate_invocation_refused` terminal contract:** preflight refusal aborts the active agent invocation, terminates the write loop with `loopOutcomeKind: "gate_invocation_refused"`, `runStatus: "failed"`, `resumable: true`, `gateCommand` on `loop_finished`, matching `commitCompletionBoundary` `outcomeKind`, and `composeRunOperatorError` mapping to `reason: "gate_invocation_refused"`, `nextAction: "resume"`, `retryable: true`; no in-iteration agent reprompt and no second refusal in the same settled iteration; rules out continuing the iteration after refusal and rules out unnamed / non-resumable refusal.
- **Enriched `iteration_timeout`:** ceiling kill during tracked active gate keeps `iteration_timeout` but adds `gateInvocationCommand` and `gateInvocationElapsedMs` on `loop_finished`; agent-stall `iteration_timeout` omits those fields; rules out undifferentiated `iteration_timeout`.
- **Gate-only resumability:** `iteration_timeout` with every non-gate non-human-only criterion for the active subspec ticked and only gate criteria outstanding settles `resumable: true` even though the subspec stays in `remainingSubspecPaths`; rules out requiring `completedSubspecPaths.length > 0`.
- Rules out raising `iterationCeilingMs` as the fix; overrun scales with lane count so any fixed ceiling is beaten by one more lane.

## Tasks

- In the write-loop gate callback: compute `iterationCeilingMs` headroom since `iteration_started`; refuse when headroom `< TEST_STEP_BUDGET_MS` and settle `gate_invocation_refused` per the terminal contract above.
- Try-acquire the `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` slot on gate detection (refuse on miss, per the terminal contract); release on shell-tool completion or iteration loss.
- Add `isGateAcceptanceCriterion` helper (shared or write-loop) using backtick token extraction + `isReadyTestCommand`; extend `finishIterationTimeout` resumability with gate-only-outstanding rule bound to `expectedArtifactPath`.
- Extend `WRITE_LOOP_OUTCOME_KINDS`, `LoopFinishedEvent`, `WriteLoopResult`, `finishLoop`, and idempotent `committedResult` replay for `gate_invocation_refused`, gate-only `iteration_timeout` resumability, and enriched timeout fields.
- Wire downstream surfaces: `v2/src/persistence/log-stream.ts` event fields, `v2/src/daemon/run-operator-error.ts` + `run-operator-error.test.ts` (`gate_invocation_refused` reason and resumable enriched `iteration_timeout`), `workflow-runner-resume.ts` resume admission when applicable, `workflow-list-snapshot.ts` (`WorkflowStepTerminalOutcome` / `stoppedOutcomeForRun` — otherwise `gate_invocation_refused` mislabels as `invocation_failure` in run-list projection), `execution-terminal-settlement-guard.ts` inventory if new boundary writers appear.
- Add `write-loop.test.ts` regressions for preflight refusal, in-process cross-lane serialization, gate-only-outstanding resumability, enriched vs plain `iteration_timeout`, and `committedResult` replay of gate-only resumability; add `// @mutate` checkpoints on refusal and resumability guards.
- Reconcile `v2/docs/operator-runbook.md` § Concurrency — retire or replace the interim "hold at two concurrent implements" and pre-fix 45-minute death signature with post-fix semantics (one concurrent full-suite gate invocation per daemon process, preflight refusal, gate-only resume); also reconcile the "Don't run two implement runs at once" cross-reference under the `idle_output_timeout` test-contention entry, which points back to the same interim guidance.

## Acceptance criteria

- [ ] `write-loop.test.ts` proves a write step whose remaining `iterationCeilingMs` headroom cannot accommodate `TEST_STEP_BUDGET_MS` refuses to start a gate invocation and settles `loopOutcomeKind: "gate_invocation_refused"` with `gateCommand` on `loop_finished`; it fails against the current unaccounted invocation reachable on main.
- [ ] `write-loop.test.ts` proves that when two lanes detect a gate invocation concurrently in one process, only one acquires the sole `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` slot and proceeds while the other settles `gate_invocation_refused`; it fails against the current uncoordinated invocation reachable on main.
- [ ] `write-loop.test.ts` proves a lane killed during a gate invocation with every non-gate criterion for the active subspec ticked settles `resumable: true`; it fails against the current `hasCompletedSubspec`-only rule reachable on main via `iteration_timeout with no completed subspec stays non-resumable`.
- [ ] `write-loop.test.ts` proves gate-invocation ceiling `loop_finished` output carries `gateInvocationCommand` and `gateInvocationElapsedMs` while agent-stall `iteration_timeout` omits them; it fails against the current undifferentiated `iteration_timeout` reachable on main.
- [ ] `write-loop.test.ts` proves `committedResult` replay preserves gate-only-outstanding `iteration_timeout` resumability across idempotent re-entry; it fails against the current `hasCompletedSubspec`-only `committedResult` branch reachable on main via `committedResult echoes recomputed iteration_timeout inventory with divergent roots`.
- [ ] `run-operator-error.test.ts` proves `gate_invocation_refused` maps to `nextAction: "resume"` and enriched resumable `iteration_timeout` retains `nextAction: "resume"`; it fails against the current missing `gate_invocation_refused` entry reachable on main.
- [ ] `v2/docs/operator-runbook.md` § Concurrency documents post-fix operator semantics — one concurrent full-suite gate invocation per daemon process, preflight refusal when ceiling headroom is insufficient, and gate-only-outstanding resume — and reconciles (not appends past) the retired interim two-lane hold, including its "Don't run two implement runs at once" cross-reference under `idle_output_timeout`; it fails against the current contradictory concurrency guidance reachable on main.
- [ ] `v2/docs/write-behavior.md` documents gate-invocation detection, `TEST_STEP_BUDGET_MS` ceiling preflight, in-process serialization (`MAX_CONCURRENT_AGENT_GATE_INVOCATIONS`), gate-only resumability, and `gate_invocation_refused` / enriched `iteration_timeout` settlement fields.
- [ ] `v2/docs/v1-behaviors.md` records gate-invocation budget accounting and in-process serialization across implement lanes.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Concurrency: post-fix gate-invocation ceiling, preflight refusal, gate-only resume; reconcile interim guidance.
- `v2/docs/write-behavior.md` — detection, budget preflight, serialization scope, resumability, settlement fields.
- `v2/docs/v1-behaviors.md` — gate-invocation budget accounting and in-process cross-lane serialization.
