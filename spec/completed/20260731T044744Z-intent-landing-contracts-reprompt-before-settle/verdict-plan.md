# Adjudicator verdict

Required refinements before merge:

## Subspec 01 — prefix normalization pipeline

1. **Normalize before filename validation.** The spec must state that `NN-` prefix stripping runs before filename validation, not only inside the repair pass. Committed code validates filenames first and rejects prefixed names today; without an explicit reorder, implementers will follow the task checklist and fail the landing AC.

2. **Normalize before content repair.** The spec must state that prefix strip precedes `repairIntentFile` (or equivalent content repair). Repair derives slug from basename; stripping after repair can corrupt `name:` alignment for prefixed filenames.

3. **Post-normalize duplicate basenames.** The spec must classify two staged files that normalize to the same basename (e.g. `01-foo.md` + `02-foo.md`) as an immediate validation failure via the existing duplicate-name check — not silent overwrite or reprompt.

4. **Mutation checkpoint targets the guard, not only the rename body.** The inversion AC must name the pipeline-order guard (skip normalize-before-validate), not only the rename implementation inside repair.

## Subspec 00 — prompt contracts

5. **Remove false pre-fix failure on prerequisites.** The prerequisites one-bullet-per-line rule and a substring test already exist in committed code. The prerequisites AC must be reframed as dedicated regression pinning or a citation of existing coverage — not “fails against the pre-fix prompt.”

6. **Filename contract AC stays as the new-behavior pin.** The no-`NN-` prefix filename AC remains the subspec’s genuine failing-test surface.

## Subspec 02 — reprompt loop (core)

7. **Cross-iteration retry model.** The spec must explicitly require a write-loop `continue` path on landing-contract miss that consumes iteration budget across separate loop iterations — distinct from terminal `contract_miss` (first-miss exit) and from `missing_blocker` (in-step sub-invocation). Intent rules out first-miss `landing_failed`; deferring loop-control semantics is not acceptable.

8. **Landing-contract miss must not use `contract_miss` or `appendBlockerToSpec`.** The spec must state that landing-shape misses reprompt in-loop and do not append blockers to `specPath` via the existing `contract_miss` terminal path.

9. **Violation taxonomy.** The spec must classify landing violations by harness behavior:
   - `NN-` prefix → normalize (subspec 01)
   - Agent-fixable shape (prerequisites prose, `name:`/slug mismatch, H1, missing `## Prerequisites`, etc.) → reprompt within budget
   - Non-repromptable (rogue path, duplicate/collision after normalize, empty stage, I/O) → immediate terminal `landing_failed` without spending reprompt budget

10. **Pre-completion gate semantics, not pipeline index wording.** Replace “post-repair, pre-rogue-file scan” with the intended contract: validate shape after repair and prefix normalize, before the write loop accepts `complete`; rogue detection uses write-loop-appropriate `modifiedPaths` consistent with deferred landing.

11. **Surface offending file in reprompt.** Task/AC coverage must require validation (or a wrapper) to supply violation message plus offending staged file path; first violation wins when multiple files fail.

12. **`modifiedPaths` parity.** The pre-completion gate must use the same `modifiedPaths` source as `landIntentWorkflowOutput` so rogue-path behavior does not diverge between write-loop and deferred landing.

13. **Write-step `landing_failed` resume is end-to-end, not projection-only.** Intent requires `resumable: true` / `nextAction: "resume"` after budget exhaustion. The spec must either add a workflow/daemon AC proving write-row resume re-enters the write loop (via existing `reconstructWriteResume` plumbing), or explicitly document that plumbing as the satisfaction path and distinguish it from review-row finalization replay. `composeRunOperatorError` projection alone is insufficient for the intent’s operator claim.

14. **Review-last inheritance.** Add a preservation or narrow regression AC: deferred landing on already-valid staging does not emit a second reprompt pass.

15. **Workflow-tail `landing_failed` preservation.** Add a refactor-style AC citing an existing collision/I/O tail-landing test so non-repromptable workflow-tail failures stay unchanged.

## Intent-level (`intent.md`)

16. **Distinguish write-loop vs publication-tail failure.** Reword acceptance criteria that say the run “settles `landing_failed` immediately” to reflect today’s actual layering: the write loop completes, then the publication tail settles `landing_failed`. New behavior is reprompt before write-loop completion and terminal write-loop `landing_failed` only after budget exhaustion.

17. **Prerequisites portion of rendered-prompt AC.** Align with subspec 00: drop false pre-fix failure for prerequisites; filename contract remains the new pin.

## Documentation (subspec 02)

18. **Disambiguate write-row vs review-row `landing_failed` in operator runbook.** § “Intent finalization failed with staged files remaining” must split or sub-section: review row → finalization replay only; write row → reprompt budget spent, hand-edit stage + `jarvis run resume` re-enters the write loop. Name how operators identify the row (`runId` / step).

## Subspec 02 sizing

19. **No split required** for gate + reprompt + terminal settlement — one observable behavior. **Do not merge without closing item 13** (resume verification or explicit plumbing documentation); that gap makes the intent’s `resumable`/`resume` claim unverified.

## Rationale (summary)

Refinements track committed code seams the spec currently misstates or leaves implicit: validation order, loop-control mechanics, violation classification, and operator resume semantics. Several ACs assert pre-fix failure where behavior or tests already exist (prerequisites prompt), which violates the failing-test requirement’s purpose. Intent decisions are sound; the spec is not merge-ready until pipeline order, loop model, taxonomy, false AC claims, and write-vs-review `landing_failed` operator semantics are explicit and testably pinned.