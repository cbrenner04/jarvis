## Verdict — required outcomes

### 1. Restore pre-advance harness stderr for every advancing actuator rung

Non-final attempts that advance (native quota, lenient weak-quota upgrade, idle-timeout) must emit the same harness sequence as before the migration:

- `review: actuator error (<classified.kind>)` on every non-ok advancing rung
- Raw stderr fanout when `classified.kind !== "quota"` and stderr is non-empty (including `aborted: idle-timeout` on idle advances)
- Then the existing quota/idle fallback lines and telemetry

The post-executor replay loop currently emits only fallback lines for `execution.attempts.slice(0, -1)`, so advancing rungs lose the error prefix and idle raw stderr. That breaks the spec task to preserve current message text and the lenient-classification contract (lenient-upgraded rungs must log `error (quota)` before the lenient fallback line).

### 2. Add test coverage for single-build prompt reuse across actuator rungs

The acceptance criterion requiring one caller-built verdict prompt reused on every rung is structurally met (`buildVerdictActuatorPrompt` once, `authoritativePrompt` on each binding) but not pinned by tests. Add a review-actuator test that proves prompt text is built once and passed identically to every actuator agent invocation (e.g. spy on `buildVerdictActuatorPrompt` or assert identical prompt on each `run` call). Do not leave that AC satisfied only by code inspection.

### 3. Remove unreachable zero-rung handling after shared execution

With the `actuatorOrder.length === 0` pre-executor guard in place, `executeWithQuotaFallback` always receives a non-empty binding list, so the `execution.final === null` branch is dead code that duplicates the early exit and could mask a future regression if the guard is removed. Remove it so zero-rung termination is enforced only by the pre-executor path the spec requires.

### 4. Revert unrelated `v2/src/cli.test.ts` changes

This branch deletes `config set-agents` / `config show` coverage and adjusts unrelated write-loop plumbing. None of that is in scope for review-actuator migration. Revert those changes so the PR diff matches the spec surface.

---

**Not required for ship** (no actuator action): implicit post-classification `shouldAdvance` coupling (document optionally); `invokeAgent` not forwarding executor `signal` (latent, no current regression); `attemptByBinding` side channel; always-on binding `metadata`; shrink’s hand-rolled loop (out of scope); stale in-source comment on `executeWithQuotaFallback` (durable docs already updated); strengthening the zero-rung test beyond observable stderr/exit once the dead branch is removed.
