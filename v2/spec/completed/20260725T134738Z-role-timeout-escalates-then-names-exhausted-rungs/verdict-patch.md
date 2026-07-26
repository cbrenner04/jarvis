## Verdict — required outcomes

### 1. Wall-clock timer must actually be per rung (or the docs must stop claiming it is)
The timer is armed once per escalation *segment*, and a segment covers the whole quota walk over the remaining suffix. So a rung reached via quota fallback inherits whatever is left of the previous rung's clock (rung1 quotas at 29m, rung2 gets aborted 1m later). Subspec 00 decision 4 states each binding attempt gets a fresh `roleTimeoutMs`, and `agent-model-config.md`, `workflow-runner.md`, `v1-behaviors.md`, and `operator-runbook.md` all promise per-rung timers and an N × bound worst case. Today that is only true along the pure-timeout path.

Required: behavior and documentation must agree. Preferred outcome is that every binding attempt genuinely starts with a full `roleTimeoutMs` (which may require a per-attempt signal seam in the shared executor while keeping one quota walk per segment, per decision 2). If that seam is judged out of scope for this slice, the four docs above must state the actual rule — the wall clock is armed per escalation segment and is shared across bindings consumed by quota inside that segment — and 00's decision 4 tension must be called out rather than left implicit. Silent divergence between decision, docs, and code is not acceptable.

### 2. `bindingAttempts[].resultKind` must report each rung's real outcome
Every merged attempt is currently written as `resultKind: "timeout"`, discarding the attempt's actual result. A rung consumed by quota is reported to the operator as having timed out. Subspec 01's contract is per-rung timeout summaries for rungs that *timed out*; the type doc sells `resultKind` as the attempt's outcome. Required: each entry carries the attempt's true kind, with `"timeout"` used only for the attempt the wall clock actually aborted.

### 3. `exhaustedRoleTimeout` must mean every rung timed out
The gate is set whenever the last segment timed out, regardless of how earlier rungs were consumed. A list where rung1 hit quota and rung2 timed out settles `stop` / `retryable: false`. The entire warrant for `stop` is determinism — "re-dispatch spends the same N × bound to hit the same wall" — and that reasoning does not hold for a quota-consumed rung, which may succeed later. Subspec 01 defines exhausted as "every configured binding timed out in the invocation." Required: the exhausted gate is set only when every attempt in the invocation was a wall-clock abort; a mixed quota/timeout exhaustion keeps the non-exhausted mapping. Cover this with a test (quota on rung1, timeout on rung2) — no test currently exercises quota and timeout together, which is where findings 1–3 all live.

### 4. Success must win over a concurrently-firing timer
`timedOut` is checked before anything inspects `execution.final?.result.kind`. If a binding resolves `ok` in the window where the timer has already fired, the invocation either burns a further paid rung or settles `stop` on a role that actually succeeded. Subspec 00 requires that `ok` on any attempt stops without invoking further bindings; today that holds only incidentally. Required: a successful final result short-circuits ahead of the timeout branch, and the guard is covered by a test.

### 5. Caller-abort non-advancement must be proven
The caller-signal-abort test supplies a single binding, so it cannot distinguish "abort suppresses escalation" from "there was nothing to advance to." Subspec 00's AC explicitly requires a negative case proving the next binding is not invoked. Required: that test supplies a following binding and asserts it was never invoked.

### 6. Profile-review path must derive its gate input from the shared builder
`runProfileReviewStep` hand-assembles the `{failureKind, exhaustedRoleTimeout}` object it feeds the retryability gate, and selects the failed role's execution differently from `standardReviewRoleFailureOutcome` (`result.failedRole ?? lastCycle.failedRole`). The gate itself is correctly shared; its input should be too. Required: that call site builds its input from `buildReviewInvocationFailureDetail` (or an equivalent single derivation) so role selection and gate input cannot drift between paths.

### 7. Documentation accuracy
- `v2/docs/write-behavior.md` still states `bindingAttempts[].resultKind` "is that attempt's `InvocationResult.kind`"; the widened union makes that false. Add the `"timeout"` caveat.
- `daemon-host.md` / `workflow-runner.md` should note that the non-exhausted `role_timeout` → `retry_later` row now applies to rows persisted before this change (the producer always sets the gate on newly produced timeouts). Keep the code path and its preservation tests as-is.

### Not required
Telemetry `binding_index` being segment-relative after escalation is real but originates inside `executeWithQuotaFallback`'s own enumeration; fixing it means a `shared/**` API change, which is outside both subspecs' scope. Leave it, no code change in this slice.