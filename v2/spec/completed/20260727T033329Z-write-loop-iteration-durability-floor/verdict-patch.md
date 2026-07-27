## Verdict — changes required before this lands

### 1. A settled non-`progress` iteration that races an abort/kill must still be checkpointed

`v2/src/execution/write-loop.ts:406` returns early (`if (args.signal?.aborted && result.kind !== "progress")`) before any checkpoint call. The `progress` branch checkpoints *below* that guard, so `progress` is covered and every other settled result is not. This is reachable exactly in the shape the spec was written for: a single-iteration `done` (or `stall`/`invocation_failure`) that settles while a kill is landing. `finishControlledLoss` does not cover it — that path runs only when the abort *wins* the race.

**Required outcome:** an iteration whose step result settled with real agent edits is checkpointed before the loop returns, regardless of result kind and regardless of whether the abort signal has fired. Kill-state precedence and the no-boundary/no-publication behavior on abort must be unchanged.

**Required coverage:** the existing kill tests all force settlement strictly *after* the abort (`resolveOnAbort`), so they exercise only the loss path. Add a case where the write settles *before* the abort fires with a non-`progress` result, proving the agent's edits are committed and the worktree is clean. Spec 00's "checkpoint every git-backed settled main-loop iteration before its SQLite boundary" is not met without this.

### 2. A settled result with no binding must skip the checkpoint, not fail the run

`invocation_failure`/`no_binding` (`step-runner.ts:291-297`) carries `invocation.final === null`. `commitSettledIteration` throws `completion attribution is missing` (`write-loop.ts:1545`) on any worktree with `.git`, so the run now reports `iteration_commit_failed` and loses the real `failureKind` and `bindingAttempts` detail. The existing `no-binding-run` coverage misses this because its worktree has no `.git` and short-circuits on `no_git`. This path is live (empty-bindings resume), and the spec explicitly requires preserving each real step outcome.

**Required outcome:** when there is no final binding, the checkpoint is skipped (nothing was attributed and nothing an agent wrote), the run reports its true `invocation_failure` outcome with detail intact, and a git-backed regression pins it.

### 3. Waiting for quiescence must not be unbounded

`await execution` (`write-loop.ts:799`) runs after all watchdog/abort timers are cancelled. An invocation that ignores its `AbortSignal` — the case the spec explicitly excludes from the floor — now hangs the loop forever: no `loop_finished`, no boundary, run stuck `in-progress`. Exclusion from the guarantee is not license to convert it into a hang; the prior behavior settled. Note that every never-quiescing fixture in the branch (`workflow-step-fixtures.ts`, `write-loop-session-log.test.ts`, `write-loop-idle-watchdog.test.ts`, and three inline `executeWrite` mocks) was rewritten to settle on abort, removing the coverage that used to pin non-blocking settlement.

**Required outcome:** the quiescence wait is bounded. If the invocation does not quiesce within that bound, the loop falls through to the un-checkpointed loss exactly as before and still emits its terminal settlement. At least one retained fixture must never quiesce and assert the loop still settles. Document the bound wherever the quiescence contract is described.

### 4. Cheap correctness/accuracy items

- **Watchdog branch lacks the killed-status guard.** Only the `"aborted"` branch of `finishControlledLoss` protects an already-persisted `killed` status from being clobbered by a checkpoint failure. Hoist the killed-status check ahead of the race discriminator so a watchdog firing after `commitGuardedKill` cannot overwrite it.
- **`v1-behaviors.md` "suppresses late settle, throw, or abort effects"** is now wrong for settle: a late settle is consumed and checkpointed, not suppressed. Correct that clause.
- **`killAfterDispatch` doc comment** describes `abort()` then `commitGuardedKill`; the code does the reverse, and the reverse is correct (the kill must be durable before the checkpoint runs, or `kill checkpoint failure preserves killed state` proves nothing). Fix the comment to state that ordering and why it matters.

### Explicitly out of scope

Appending a `contract_miss` blocker on the loss path — Spec 00 scopes that decision to the settled main-loop path, and on a loss the attempt is never persisted as `contract_miss`. Leave as-is.