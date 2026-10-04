## Verdict: required outcomes

### 1. Lint must be clean and the working-tree edit committed
`bunx biome check v2/src/execution/workflow-runner.ts` is currently red (import organization on the new `review-role-invocation` import plus two formatter violations at the `buildReviewRoleTelemetryFields` call site and the missing-verdict `return`). The uncommitted refactor in the working tree must land with the change; the branch cannot pass the ready gate as-is.

### 2. Actuator-only admission must be gated to single-cycle review
`tryActuatorOnlyReviewDebateRetry` admits on role + `failureKind` alone, ignoring `step.maxCycles`. `reviewPasses` is operator-settable and flows into `maxCycles`, so a multi-cycle review that fails at an intermediate cycle's actuator would retry one actuator and return `complete`, silently dropping the remaining review cycles. The subspec requires admission be limited to the last cycle failing at the actuator, **or** scoped to single-cycle presets. Take the in-scope option: multi-cycle steps must fall through to the existing full-debate path, with a test pinning it. This also makes the retry's prompt-context reconstruction (pass 1, no prior-cycle verdict) correct by construction rather than by coincidence — say so in a comment.

### 3. Missing/empty verdict recovery must be truthful
The missing-verdict guard settles a failure whose persisted detail carries no `role`, so a subsequent re-dispatch is no longer actuator-eligible and replays the full debate on a fresh run row. The runbook currently instructs the operator to "recreate the verdict … before re-dispatching," which will not produce actuator-only replay. Reconcile: either preserve actuator eligibility across the guard failure so the documented recovery works, or correct the runbook to describe what actually happens. The docs and the code must agree.

### 4. The success path needs test coverage
Every new test terminates in an actuator failure. Nothing exercises the retry's completion leg: `runStatus: "completed"`, `outcomeKind: "done"`, `completionAgent` extraction, the landing branch, and the `kind: "complete"` return — roughly half the new function and the actual point of the feature. Add a test where the retried actuator succeeds. (The unused `actuatorFailureKind === undefined` branch in the tracked binding helper already anticipates it.)

### 5. Prompt parity must be asserted, not just claimed
The decision that actuator-only retry uses the same prompt path as the first attempt (including `profile.render.actuator`) rather than a raw-verdict bypass has no test — the tracked binding discards `prompt`, and assertions only check that the verdict *file* is unchanged. Assert that the prompt the retried actuator receives carries the persisted verdict content, and cover the configured-renderer case. Also cover the empty-but-present `verdictPath` half of the guard (only file removal is tested today), and assert in the debate-role negative case that a *new* run row is created — that is the property distinguishing it from the actuator-only path.

### 6. `buildReviewInvocationFailureDetail` change must be tidy and documented
Folding `idleTimeout` into the persisted detail is necessary (stalls otherwise never record `role`, and the stall criterion cannot pass), but the current form is confused: it reads `timeout?.boundMs` inside a branch where `roleTimeout` is provably defined, mixing the message condition and the spread source. Separate message construction from attribution so each is obviously correct. This is also a persisted-shape change affecting **all** review roles, including critic/actuator `review` steps — add it to the `v1-behaviors.md` entry rather than leaving it as an undocumented side effect.

### 7. Minor cleanups
- `createReviewDebateActuatorFailureBindingFactory` now has no caller passing `onActuatorInvoke`; drop the dead parameter.
- The reused run row keeps the original workflow snapshot, so a config edit between dispatches is not picked up — same trap as the existing "review re-dispatch does not re-resolve implement bindings" caveat. One runbook sentence next to that note; refreshing the snapshot is out of scope.

Not required: extracting a shared actuator-leg helper between the retry path and the debate's actuator leg (the leg is thin and stable); a separate stall + missing-verdict test (the subspec explicitly shares that guard); a distinct invertible guard artifact for the guard-inversion criterion (the eligibility early-return satisfies the invertibility property the criterion demands).