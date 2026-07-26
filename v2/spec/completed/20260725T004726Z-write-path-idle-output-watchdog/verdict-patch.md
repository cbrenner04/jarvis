## Verdict

The shipped mechanism is sound — arming, the distinct `idle_output_timeout` outcome kind, run status, operator-error mapping, snapshot persistence, and resume rehydration all check out. The debt is in **test evidence for three ticked acceptance criteria**, **stale/overclaiming docs**, and **test hygiene**. Required outcomes:

### Test evidence (ticked ACs not met as written)

1. **Plan-draft and intent-split coverage must exercise the write loop / workflow, not just `executeWrite`.** The two new tests in `v2/src/execution/write.test.ts` assert the step-runner-level `result.result.kind === "stall"`; the AC requires asserting the settled outcome `idle_output_timeout` (and that it is not `iteration_timeout`) for a silent agent on those two prompts. Raise them to the level where the outcome kind is committed, or un-tick the AC. They are also near-duplicates — consolidate.

2. **A disabled watchdog must be shown to change write-iteration behavior.** Today only the config loader asserts key omission at `idleOutputTimeoutMs: 0`. The AC also claims a silent write iteration under a disabled watchdog produces no `idle_output_timeout` and settles on the wall instead; nothing asserts that. Add it, or narrow the AC text to what is actually proven.

3. **The resume AC claims a silent agent on resume settles `idle_output_timeout`; the test only asserts the bound reaches the spawn call.** Either drive the resumed step to the outcome, or reword the AC to the rehydration guarantee it verifies.

4. **`v2/src/execution/step-runner.test.ts:1026` is titled "write-step invocation does not receive idleOutputMs"** — that title asserts the contract this spec inverted. Retitle to the omission behavior it actually checks, and add the missing positive case: a primary `runStep` invocation given `idleOutputMs` reaches the binding armed. Only the reprompt fixtures currently inspect that boundary.

### Documentation corrections

5. **`v2/docs/install-and-config.md` overclaims.** It says the watchdog is armed on "every write invocation." The post-iteration coverage advisory invocation in `write-loop.ts` is unarmed (no wall, no ceiling, no idle bound). Scope the sentence to the iteration's step and reprompt invocations. Arming the advisory itself is out of this spec's scope — the intent names three call sites — but the prose must not claim more than the code does.

6. **`v2/docs/operator-runbook.md:341-345` is now false.** It states the idle-output watchdog "applies only to review-step role invocations." This branch edited the narrative section of the same file while leaving this normative passage stale. Correct it, and keep it consistent with the `role_stalled` (retryable) vs `idle_output_timeout` (non-retryable, `stop`) distinction.

7. **`v2/docs/workflow-runner.md:21-25` is the durable home for what a write step resolves and snapshots** and still names only `iterationTimeoutMs`. Add `idleOutputMs` (resolution, snapshot retention, resume) there.

8. **Document the absent-bound-on-old-snapshot behavior.** `daemon.ts` falls back to machine config for a missing `iterationCeilingMs` but deliberately does not for `idleOutputMs` — because the loader omits the key when disabled, a fallback would silently re-arm an operator's disabled watchdog. That asymmetry is defensible but currently undocumented and unasserted; state it in one sentence in `v2/docs/write-behavior.md`.

### Hygiene

9. **Remove the intra-file ordering dependency in `write-loop-idle-watchdog.test.ts`.** Its comment claims `mock.module` cannot be restored to the real export; other tests in this repo do exactly that. Restore the real `executeWrite` after the mocking test so no test depends on file-order.

10. **The unused `"stall"` outcome added to `simulatedBindings`** has no callers. Use it in the new tests or drop it.

11. **Note at the `failureKind: "stall"` detail construction in `write-loop.ts`** why an `idle_output_timeout` attempt carries an `invocation_failure`-shaped detail — reuse was a deliberate spec decision, but the shape is surprising to a future consumer switching on `failureKind`.

### Out of scope — do not address here

Arming the coverage advisory; what work survives a stalled iteration (ready-gate repair committing `failed` then continuing); `write --json` attribution parity; the recovery-string wording. These are either pre-existing shapes the new kind merely inherits or explicitly deferred by the intent.