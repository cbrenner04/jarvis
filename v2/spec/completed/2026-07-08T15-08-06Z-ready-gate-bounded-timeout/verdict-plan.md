**Verdict: Refine required.**

The following must be addressed before this spec is ready:

1. **Scope statement.** The spec must explicitly state that it applies to *every* `runReadyAndCommit`/`runReadyGateWithTier` call site in the repo, not just the four the intent names as examples. Add a one-line rationale tying this to the intent's own general principle ("every other jarvis operation gets a budget"), so the eight-site enumeration reads as a completeness claim rather than an arbitrary expansion.

2. **Site→label mapping table.** Every call site listed in the acceptance criteria (completion-pipeline.ts, review.ts baseline/final, shrink.ts, pr.ts, auto-integrate-base.ts, plan/pr.ts, triage.ts) must map unambiguously to its `agentLabel` value. `patch-complete` and `review-incomplete` currently appear in the Decisions section with no owning call site — resolve this so an implementer can determine the label at each site without guessing.

3. **Signal-vs-timeout disambiguation.** The spec must distinguish "our `timeout` fired" from "the process was killed for another reason" (e.g., operator Ctrl-C/SIGINT). Relying on `err.killed === true` alone is insufficient — a plain interrupt would falsely be reported as "exceeded budget." Add a decision on how the two are distinguished (e.g., checking `killSignal`/`signal`, or another mechanism).

4. **Explicit retry-semantics decision.** The intent frames this as a hard-fail; the spec currently reuses existing `FixCommandError`/`ReadyCommandError` classes and inherits their `instanceof`-based retry classification unchanged, without stating whether that's actually correct for a timeout (as opposed to just convenient). The spec must make a deliberate, stated call: either confirm the existing classification already treats these errors as non-retryable/appropriate, or add a decision for how timeout failures are classified for retry purposes.

5. **Testability approach.** Decisions must state how the acceptance criteria (which require observing timeout-triggered aborts) are verified without tests that actually wait out `iterationTimeoutMs` — e.g., injecting a small timeout value in tests, or mocking the exec call. Without this, the subspec leaves test design undefined at implementation time.

6. **Subspec-size acknowledgment.** Add a brief note in Decisions or Out of scope that this is a single mechanical, uniform change (one field + one message format) applied identically across sites, justifying keeping it as one subspec despite touching eight files.

7. **Doc-update accuracy on the corrected default.** The Documentation updates section should explicitly note that docs must state the real 30-minute default (not the intent's stated 10 minutes), so the correction made in Decisions doesn't rely on implicit propagation into the docs.

8. **Verify (not just assert) Bun's `err.killed` semantics.** The claim that Bun's `execFileSync` timeout guarantees `killed`/`signal` on the thrown error, without a specific `code`, is an empirical claim presented as settled fact. Either the spec should note this needs verification at implementation time (with a fallback if unconfirmed), or cite where this is already confirmed for Bun specifically (not just Node).

No changes needed regarding the structural/harness-flavored acceptance criteria (permitted under the harness-subspec carve-out) or nested child-process cleanup on kill (out of scope, pre-existing property of the underlying scripts, not worsened by this change).