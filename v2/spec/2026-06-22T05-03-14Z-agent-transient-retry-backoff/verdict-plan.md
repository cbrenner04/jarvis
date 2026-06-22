## Verdict — refinements required

The spec's direction (bounded escalating backoff behind an injectable sleep seam, widened cap) is sound and accepted. Three blocking refinements and three minor ones must land before merge.

### Blocking

1. **The cap widening (2→3) is an unacknowledged behavior change to a test the spec never names.** `spawn.sandbox-unrunnable.test.ts` pins the exact retry contract: spawn count (`toBe(3)`), the `onTransientRetry` payloads (`{ attempt, cap: 2 }`), and the test name references "cap of 2 retries." Widening the cap breaks all of these. The spec's acceptance criteria assert only `quota.test.ts` and `run.test.ts` "stay green" and omit this file entirely. This is the precise failure mode the spec guidance forbids — claiming green for a test the author didn't locate, when the change actually rewrites that test's contract. **Refinement:** add an explicit task and AC naming `spawn.sandbox-unrunnable.test.ts` as a file the spec *updates* — spawn count (3→4), the reported `cap` value, the payload assertions, and the test name — rather than treating it as a preservation.

2. **Abort latency during backoff is unresolved.** The existing loop notices an abort near-instantly because retries fire back-to-back; with a `[1s,2s,4s]` schedule, an abort (Ctrl-C) arriving mid-sleep can wait out up to 4s before the next loop iteration checks `signal.aborted`. The spec's "no sleep when aborted" decision only covers the pre-sleep check, not abort *during* the sleep. **Refinement:** the spec must resolve this explicitly — either race the sleep against the abort signal, or record a load-bearing decision accepting the ≤4s post-abort latency (with rationale that a killed run is terminal). Silence is the gap; pick one and state it.

3. **The new test's relationship to existing transient tests is unspecified, and the seam must be injected into them.** The existing cap-exhaustion test already drives `runAgent` to a transient error via a stub binary; the schedule assertion most naturally extends that test rather than running as a parallel new test beside an un-updated one. More importantly, those tests currently call `runAgent` with no sleep seam — once a default *real* sleep exists, the cap-exhaustion path wall-clocks ~7s (green but materially slower). **Refinement:** make injecting a no-op/recorder sleep into the existing transient tests an explicit, non-optional task, and state which existing test absorbs the schedule assertion versus what is genuinely net-new (the injected-sleep-recorder mechanism).

### Minor

4. **Callback/backoff ordering** — state in Decisions that `onTransientRetry` fires *before* the backoff sleep, since the "retrying" signal otherwise implies an imminent (not delayed) re-attempt.

5. **Numbering frame is self-contradictory** — Decision 1 counts "re-attempts 2/3/4" (spawn-index) while the checklist says "before each re-attempt" (re-attempt-index). Pick one frame consistently.

6. **Note the async-vs-sync seam swap** — the intent references `withSyncTransientRetry`, but that path is synchronous (`sleepSync`) while `runAgent` is async; the spec correctly mirrors the async `runGhCommand`/`sleepMs` seam instead. Add a one-line note so a reviewer reconciling against the intent does not flag the divergence as an error.

### Rationale

Items 1 and 3 are the same editing obligation surfacing twice: `spawn.sandbox-unrunnable.test.ts` must be touched for the cap change anyway, and that is where the seam injection and schedule assertion belong. The guidance's "cite the test, don't paraphrase / don't assert green for tests you didn't locate" principle is directly implicated — the current ACs make a false preservation claim. Item 2 is a genuine behavioral regression the escalating schedule introduces and the spec does not address. The minor items pin operator-observable ordering and prevent reviewer confusion against the intent.