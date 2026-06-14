# Verdict — Refinements Required

The spec is structurally sound and its two-slice split is correct. But the shrink-step slice (`01`) rests several load-bearing guarantees on deferrals and prose that cannot actually deliver them. The following must be refined before this is ready.

## Must address

**1. Strike the false `ready`-enforces claim.**
The deferral text asserts the tests-pass / no-AC-regress / no-test-deletion guardrails are "enforced by `ready` on the kept diff." This is wrong: `ready` runs the suite (so a *deleted* test makes it greener, not redder) and never reads acceptance criteria (so AC regression is invisible). Two of the three guardrails have no enforcer. Either pin a minimal mechanical contract now (e.g. re-run the suite *and* assert the shrink diff deleted no test files) or state plainly that these guardrails are prompt-only until a verification runner lands and accept the residual risk — but do not name an enforcer that cannot enforce. This is the spec's most concrete factual error.

**2. Specify crash-mid-shrink ordering; the current decisions conflict.**
The spec says both "commit the terminal boundary … return complete" and "never creates a resumable boundary." Against the existing recovery path (a crashed in-progress attempt re-runs as a *normal* write step; a committed run returns `complete` idempotently) these pull opposite ways, and a crash during shrink falls into a gap either way: commit-before leaves a half-shrunk worktree resume never reverts; commit-after re-runs the shrink as a normal write step over partially-reverted code. The existing resume logic has no concept of shrink. The spec must make an explicit decision for crash-during-shrink and add an AC covering it.

**3. Resolve the snapshot/restore deferral — it is load-bearing, not free.**
Discard-on-miss surviving a crash requires a durable pre-shrink ref, which `01` currently defers ("pin when run history needs a durable pre-shrink ref"). The discard AC depends on that mechanism, so the deferral cannot be free. Pick one position and write it down: either (a) discard must survive crashes → the ref is required now, or (b) discard is scoped to *in-process* miss only → state that crash-mid-shrink falls back to the normal re-run path, and acknowledge the "never gates ready" guarantee is correspondingly weaker.

**4. Resolve the diff-base deferral — also load-bearing.**
The headline guardrail ("files the iterations didn't touch are off limits") cannot be expressed without a base ref the shrink agent can diff against; the current execute-prompt placeholders carry none. Either inject a base ref into the shrink prompt so scope is enforceable, or state explicitly that "the run's diff" is advisory framing in prose only. Listing diff-base as a safe deferral is inconsistent with making it the central scope guardrail.

**5. Define "clean terminal success" against the actual token set.**
Keep-vs-discard hinges on this phrase, but the loop's terminal tokens are `done | no-work | blocked | progress` and the step runs exactly once (so `progress` cannot iterate). Pin the success condition to a concrete classification (e.g. terminal `complete`), treat everything else as a miss → discard, and constrain the shrink rules text to emit only the success-eligible tokens.

**6. Add an AC for idempotent no-re-shrink on resume.**
`01` decides a `completed` run resumes without re-shrinking but no AC verifies it. Given the unresolved ordering above this property is not free — add an AC and test that re-invoking a `completed` run performs no shrink step.

## Should address

**7. Narrow the "prompt-only fails" framing honestly.**
The intent's thesis is about *in-generation* restraint losing to the tick-the-criterion objective. In the shrink step the objective and restraint are aligned for the bulk of the work; only the three guardrails are genuinely opposed sub-goals — and those are exactly what now rests on prose (see #1). The spec should reflect that the prompt-only risk is narrow and concentrated on the guardrails, not claim the mechanical gate is delivered.

**8. Correct two architecture descriptions.**
- The decision ruling out the "CLI `--step-rules` path" names a path that does not exist; normal rules are a hardcoded default constant passed as a parameter. Reword the ruled-out alternative to the real one (hardcoding another rules constant) so the ledger entry names a *plausible* alternative.
- "loaded by the loop" / "the loop loads write.shrink" implies new loop machinery; prompt loading happens in the render step today. State the actual mechanism: the loop reads the `write.shrink` body and passes it as the step-rules string to a second write step — no new loop responsibility, no step-type branching.

**9. Make the `v1-behaviors.md` decision explicit in `00`.**
Adding an authoring rule to the plan draft prompts changes observable `jarvis1 plan` output, which plausibly triggers the convention that changes to existing v1 functionality update `v2/docs/v1-behaviors.md`. Either add the entry or state in `00`'s docs section why it is omitted — do not leave it silently absent.

**10. Narrow the "machinery with no consumer yet" pattern.**
v2 deliberately stages interfaces ahead of consumers, so a shrink rule telling the agent to delete "machinery with no consumer yet" can remove intentionally-staged code with nothing mechanically protecting it. Narrow the wording (e.g. no consumer *and no spec'd future consumer*) or drop this pattern, so the checklist does not contradict the staged-skeleton build philosophy.

## Defensible with one clarifying sentence each

- **Empty-diff short-circuit:** a `no-work` completion fires a wasted shrink over a near-empty diff. Intent accepts the cost, but a one-line short-circuit note is cheap and worth stating.
- **Budget accounting:** state that a run completing on its last allowed iteration still receives the extra shrink invocation (shrink fires after terminal `complete`, outside the iteration budget).
- **Revision bump:** the mandated `draft.md` revision bump has no verifying AC; it is indirectly covered by the prompt tests, but an explicit AC would close the loop.

## Rationale

The intent's load-bearing premise is that prompt-only restraint has *repeatedly failed*, and the explicit justification for keeping shrink out of the review debate was that its verdict is *mechanical* (tests green, ACs intact, diff smaller). That mechanical gate is not realized: the verification surface is `artifact.exists` plus prose, and the crash/restore semantics that make discard-on-miss safe are unspecified. The deferral pattern itself is legitimate repo practice — but the three specific deferrals chosen (verification contract, snapshot mechanism, diff base) each turn out to be load-bearing for a headline guarantee rather than free, and one safety claim (`ready` enforces the guardrails) is factually false. Refinement must either deliver the mechanical pieces these guarantees depend on or honestly downgrade the guarantees to match what prose alone can hold.