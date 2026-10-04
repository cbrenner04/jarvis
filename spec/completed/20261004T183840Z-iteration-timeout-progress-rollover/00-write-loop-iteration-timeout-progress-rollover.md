# 00 - Rollover live-output wall timeouts with checkpointed progress

## Problem

After the wall-segment or ceiling watchdog wins and the raced-away invocation quiesces, `finishControlledLoss` always calls `finishIterationTimeout`, which commits terminal `iteration_timeout` and `loop_finished` even when the agent was still producing output and `checkpointBeforeControlledLoss` already retained a real iteration boundary commit — wasting a resumable workspace and forcing full re-dispatch.

## Decisions

- Add attempt `outcomeKind` `iteration_timeout_continued` (non-terminal, `runStatus: "in-progress"`); rules out reusing `progress` for a wall-timeout boundary that operators must distinguish from an ordinary agent `progress` token.
- After quiescence on a wall/ceiling `timed_out` controlled loss, classify rollover only when (a) the quiesced invocation settled with `result.kind !== "stall"` (same live-vs-idle signal as idle-output attribution — silent idle still settles `stall` and keeps today's terminal stall path) and (b) the checkpoint from `checkpointBeforeControlledLoss` / `checkpointSettledIteration` is `kind: "committed"` with a fresh `commitSha` (not `skipped` / reused HEAD); rules out rollover on silent stalls or checkpoint skips.
- Rollover path: commit `iteration_timeout_continued`, append `boundary_committed` with that outcome, append harness session log line `iteration timeout progress rollover (checkpoint retained)`, increment `iterationsConsumed`, and `continue` the main loop without `loop_finished`; rules out emitting terminal `iteration_timeout` on the same attempt when rollover applies.
- When rollover would leave `iterationsConsumed >= maxIterations`, skip `continue` and settle terminal stall in-loop via `finishIterationTimeout` (`iteration_timeout` boundary + `loop_finished`) — same cap tail as a silent wall timeout at the last slot; rules out deferring cap-blocked rollover solely to post-`while` `iteration_budget` without a wall-timeout boundary on that attempt.
- Terminal stall (no rollover): keep `outcomeKind: "iteration_timeout"`, `runStatus: "failed"`, terminal `loop_finished`, and set `loop_finished.resumable: true` unconditionally — drop `isIterationTimeoutResumable` from settlement (inventory fields on `loop_finished` may remain for operator context); rules out `resumable: false` on terminal wall timeouts reachable on main after this change.
- Extend `checkpointBeforeControlledLoss` (or an adjacent helper) to surface the `ProgressIterationCommitOutcome` from `checkpointSettledIteration` on success so rollover classification runs without a second commit pass; rules out duplicating checkpoint logic outside the controlled-loss seam.
- `committedResult` for terminal `iteration_timeout`: return `null` when `resumeContext.expectedArtifactPath` is set and durable `loop_finished.resumable` is true (resume admission — today's gate-only re-dispatch seam); otherwise echo terminal `iteration_timeout` with `resumable: durableLoopResumable(priorLogRecords, "iteration_timeout", true)` and inventory fields from the durable terminal row / log, not `isIterationTimeoutResumable`; rules out inventory-gated `null` and idempotent replay (`executeCalls === 0`) forcing `resumable: false` when the durable row is `true`.
- `prepareRun` keeps `reenter = committed === null || (resumeReentry && idle_output_timeout && resumable)` — do not widen `resumeReentry` to admit echoed `iteration_timeout`; rules out bypassing the `expectedArtifactPath` admission seam on workflow re-dispatch.
- `committedResult` treats last attempt `iteration_timeout_continued` like other non-terminal settled boundaries (`null`); mid-run `prepareRun` with `lastAttempt.status === "in-progress"` still re-runs the open attempt; rules out echoing a terminal result while the run is mid-rollover.
- Unsettled quiescence (`threw` / never settled) on watchdog timeout keeps today's terminal stall without rollover; rules out treating abort-quiesce throws as live output.
- `idle_output_timeout` and abort/kill controlled-loss paths are unchanged; rules out coupling rollover to non-wall outcomes.

## Task checklist

- [x] Extend `OutcomeKind` / boundary typing for `iteration_timeout_continued`.
- [x] Implement rollover vs terminal stall in `finishControlledLoss` / `finishIterationTimeout` (or a dedicated helper called from there) using the checkpoint outcome returned from the controlled-loss seam.
- [x] Enforce `maxIterations` cap before `continue` on rollover.
- [x] Remove `isIterationTimeoutResumable` from `finishIterationTimeout` / `committedResult`; implement the `expectedArtifactPath` vs durable-echo split above in `committedResult`; keep `prepareRun` re-entry predicate aligned.
- [x] Update or add write-loop tests per acceptance criteria; cite preservation anchors where behavior is unchanged.

## Acceptance criteria

- [x] A write-loop test drives continuous `onInvocationOutputProgress` past the wall with a settled `progress` token and a git fixture that produces a fresh checkpoint `commitSha`, asserts the first attempt commits `iteration_timeout_continued` with `runStatus: "in-progress"`, emits no `loop_finished`, logs harness session text `iteration timeout progress rollover (checkpoint retained)`, and starts a second `iteration_started`; it fails against the pre-fix code.
- [x] The same fixture with `maxIterations: 1` asserts terminal `iteration_timeout`, exactly one `loop_finished`, and `loop_finished.resumable: true` even when no linked subspec is complete; it fails against the pre-fix code.
- [x] A write-loop test stops after `iteration_timeout_continued` is committed (run still in-progress), then dispatches `executeWriteLoop` again on the same project/branch without `freshDispatch`, asserts `executeWrite` runs (`executeCalls > 0`), no terminal `loop_finished` on the replay dispatch, and the run is not treated as failed terminal; it fails against the pre-fix code.
- [x] `write-loop-watchdog-and-abort.test.ts` `stalled executeWrite terminates the started attempt as iteration_timeout` asserts `loop_finished.resumable: true` (silent stall — no rollover); it fails against the pre-fix code.
- [x] `write-loop-watchdog-and-abort.test.ts` `continuous output cannot extend an iteration past the hard ceiling` and `lets an observed abort win before the watchdog, but not after it` (late subcase) assert terminal `iteration_timeout` with `resumable: true`; they fail against the pre-fix code.
- [x] `write-loop-watchdog-and-abort.test.ts` `gives each iteration a fresh timeout and quiesces the second iteration's execution before finalizing` asserts terminal `iteration_timeout` with `resumable: true`; it fails against the pre-fix code.
- [x] `write-loop-idle-watchdog.test.ts` `a disabled watchdog (idleOutputMs omitted) settles a silent iteration on the wall, not idle_output_timeout` asserts terminal `iteration_timeout` with `resumable: true`; it fails against the pre-fix code.
- [x] `write-loop-coverage-and-iteration-commit.test.ts` `iteration_timeout with no completed subspec stays non-resumable` is renamed/updated to assert unconditional terminal `loop_finished.resumable: true` while still covering empty `completedSubspecPaths`; it fails against the pre-fix code until updated.
- [x] `write-loop-coverage-and-iteration-commit.test.ts` `committedResult replay preserves gate-only-outstanding iteration_timeout resumability` is updated so the idempotent replay (`executeCalls === 0`, no `expectedArtifactPath`) echoes `resumable: true` from the durable terminal row; it fails against the pre-fix code until updated.
- [x] `write-loop-coverage-and-iteration-commit.test.ts` `committedResult echoes recomputed iteration_timeout inventory with divergent roots` is updated so replay echoes `resumable: true` from durable `loop_finished` (inventory fields unchanged) instead of inventory-gated `resumable: false`; it fails against the pre-fix code until updated.
- [x] `write-loop-idle-watchdog.test.ts` `a silent agent settles idle_output_timeout well before the iteration wall elapses` stays green.
- [x] `write-loop-idle-watchdog.test.ts` `a silent agent on the %s write step settles idle_output_timeout, not iteration_timeout` stays green.
- [x] `write-loop-watchdog-and-abort.test.ts` `lets an observed abort win before the watchdog, but not after it` (early subcase) stays green.
- [x] `bun run typecheck` passes.

## Documentation updates

Deferred to [01-docs-iteration-timeout-rollover](./01-docs-iteration-timeout-rollover.md).
