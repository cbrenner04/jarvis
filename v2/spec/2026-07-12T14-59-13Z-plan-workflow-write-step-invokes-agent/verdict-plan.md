## Verdict — refinements required

**Subspec 00**

1. **State the resolution mechanism, not just the intent.** "Install root" is currently a goal, not a decision. Pin how spec-guidance is located (the existing module-relative fallback in `write.ts` is the only mechanism present) and record it as a decision that removes the `jarvisRoot` branch entirely. Rationale: the AC as written passes under multiple incompatible implementations.

2. **Rule on the `jarvisRoot` field, not just the helper parameter.** After the fix, top-level `WriteExecuteInput.jarvisRoot` has no consumer; it is threaded through `write-loop.ts`, `PlanReviewPromptContext`, and `plan-workflow-steps.ts` purely to reach the broken read. The spec's own decision rejects accepted-and-ignored arguments, so it must say explicitly whether the field and its threading are removed or retained (and if retained, why). Either way an AC must pin it — today's AC is satisfied by both outcomes.

3. **Cover all three presets.** The intent's second decision explicitly rules out fixing one preset while leaving the others untested, but no AC names `plan-reviewed` or `plan-reviewed-light`. Add an acceptance outcome that each of the three presets' draft step, constructed through the production step-builder under a production-shaped `jarvisRoot`, invokes its agent binding. Asserting through a test binding is the right level; a real subprocess is operator verification, not an AC.

4. **Guard prompt content, not just "binding invoked."** A binding-invoked assertion still passes if spec-guidance resolves to an empty or wrong file. Add an outcome asserting the rendered draft prompt actually carries spec-guidance content.

5. **Say what happens when the file is genuinely missing.** One line: the resulting throw is handled by 01's terminal-failure path (named reason, run ends). No new mechanism needed — just close the hole so the behavior isn't undefined.

*Not upheld:* bundling/compiled-binary hazards for module-relative resolution. This repo runs from a checkout; guarding a deployment mode that does not exist is invented precision.

**Subspec 01**

6. **Name the failure contract.** This is harness work where structure *is* the contract. Pin the failure-reason identifier, the terminal event emitted after `iteration_started`, and the resulting run status — reusing the loop's existing failure/finish vocabulary, or explicitly deciding against it. As written, "a failure reason naming the error" is unverifiable.

7. **Pin state-store consistency on the throw path.** The attempt is recorded as started before `executeWrite` runs, so a throw leaves an open attempt with no completion boundary. State whether the terminating path closes the attempt, and whether the run is marked resumable. Given 01's own non-retryable decision, a resumable run would contradict the spec — this must be settled, not left to the implementer.

8. **Pin abort precedence.** The loop's abort check sits after the `await`. State that an abort observed concurrently with a pre-spawn throw wins, matching the surrounding checks, so the two paths cannot disagree.

9. **Add `v2/docs/v1-behaviors.md` to 01's documentation updates.** 01 changes existing write-loop behavior; repo guidance requires any spec changing existing functionality to update the parity catalog. Straight omission.

10. **Fix the preservation AC form.** 01's final AC cites the test and then paraphrases what it asserts; drop the paraphrase and keep the citation.

**Structure:** the 00 → 01 decomposition and ordering are correct. No split required — every refinement above sits inside the existing blast radius of its subspec.