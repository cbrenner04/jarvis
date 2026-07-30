# Adjudicator verdict — intent-split-prompt-by-surface

## Required refinements

1. **Reconcile top-level `intent.md` with subspec `00` on the growth budget**  
   The seed still says an “existing split-prompt budget test.” The repo has no such test; subspec `00` correctly introduces a max-delta-over-pre-change-body constant. Top-level decisions and acceptance criteria must match that contract so plan reviewers and implementers are not sent to hunt a nonexistent guard.

2. **Extend intent-level documentation updates**  
   Add `v2/docs/v1-behaviors.md` to the intent’s documentation updates list. Subspec `01` already requires the parity-catalog change; the frozen intent must not omit it.

3. **Make subtractive prompt change part of the contract (subspec `00`)**  
   The intent is to replace symptom/behavior-slice fan-out with surface fan-out, not add a second axis. Tasks and acceptance criteria must require removing or rewriting conflicting instructions (including any “one intent per independently observable behavior/slice” wording and any bullet that forbids using output order to enforce cross-intent dependencies while the new contract requires dependency-ordered surfaces and prerequisite behaviors). Add an observable check that the artifact does not retain dual fan-out rules (e.g. body must not still instruct symptom/slice-based splitting).

4. **Single-surface unsplit path**  
   Acceptance criteria must state that the unsplit branch is keyed to a genuinely single **surface** (with a one-line rationale), not “one behavior” that can still span multiple module boundaries—the case the intent is fixing.

5. **Prerequisites vs execution-order language**  
   Subspec `00` must require the prompt’s output rules to be internally consistent: dependency order across surfaces and earlier-surface behaviors in later intents’ `## Prerequisites` must not contradict bullets that tell the model not to rely on ordering or prerequisites for sequencing.

6. **Pin AC must not be satisfiable by a minimal substring alone**  
   Keep the pinned surface-rule substring and inversion AC, but separate acceptance outcomes (or explicit assertions in named tests) for: no symptom/slice fan-out remnants, unsplit-on-single-surface, and prerequisite-behavior wiring—so passing the pin test does not suffice while old fan-out text remains.

7. **Prompt governance: `revision` bump**  
   Add an acceptance criterion that `prompts/intent/split.md` frontmatter `revision` increments when the body changes, consistent with prompt governance.

8. **Unsplit rationale placement**  
   Subspec `00` should align where the one-line unsplit rationale appears in ready-intent output with the convention expected by `intent-split-multi-surface-regression` (or equivalent regression), so prompt instructions and behavioral tests do not diverge.

9. **Failing-test wording for secondary guards**  
   For `intent split artifact growth stays within budget` and the no-examples/no-numeric-thresholds checks, state explicitly that each fails on the pre-change artifact (or name a meaningful inversion), per spec guidance for new executable guards—not only the primary pin test.

10. **Scope and sequencing notes (index or subspec `00`)**  
    - State that end-to-end multi-surface staging proof is intentionally deferred to the `intent-split-multi-surface-regression` ready-intent; this tree delivers prompt + registry/unit guards.  
    - Declare serial merge/plan ordering relative to `plan-emits-one-subspec-per-module-boundary` where both touch the same doc sections or vocabulary, per same-seam sibling guidance.

11. **Clarify “one added sentence” vs broader alignment**  
   In decisions or tasks, state that the *new* surface rule is one sentence without examples/thresholds, while symptom fan-out bullets may be rewritten or removed; net artifact growth is bounded by the subspec max-delta constant—not that the entire edit is literally one sentence.

## Rationale (summary)

Without subtractive prompt requirements and anti-dual-rule checks, implementation can add a surface pin while leaving symptom-based splitting and conflicting ordering bullets—failing the intent. Without intent/subspec parity on budget and docs, reviewers misread scope and verification. Explicit deferral of regression staging and sibling ordering reduces merge collisions and false expectations that this spec alone proves write-step outcomes.

## Not required for refinement (upheld as sufficient)

- Splitting subspecs `00` / `01` further.  
- Updating every operator doc (e.g. `intent-mode.md`) beyond the three durable homes in subspec `01`.  
- Full legislation of parallel independent surfaces or duplicate-surface edge cases in the prompt.  
- Mandatory inversion AC for budget cap or injected example blocks beyond strengthened pre-change failure wording (optional polish only).