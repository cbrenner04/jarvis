---
name: extract-workflow-runner-resume-machines
---

# Extract workflow-runner resume machines into sibling modules

## Primary implementation surface

Execution loop — plan recovery and publication resume machines in `v2/src/execution/`

Unsplit rationale: Plan recovery, both publication resume machines, shared review-landing promotion, their co-located tests, and the module-map doc updates all live on one execution-loop resume seam; splitting production code across multiple modules would not land an independently testable boundary.

## Problem

Plan recovery, intent-finalization resume, and review-mutation resume (~1,600 lines) live inline in `workflow-runner.ts` alongside shared review-landing promotion helpers, blocking review of either seam and keeping resume tests in oversized concern-group files.

## Behavior

Plan recovery, intent-finalization resume, review-mutation resume, and shared review-landing promotion helpers move to one sibling module `workflow-runner-resume.ts`; `workflow-runner.ts` keeps the step loop and imports the exported resume entrypoints. Twin settlement helpers stay separate for now; `resumable` behavior stays as-is until the follow-on merge intent. Co-located tests move with the module and split along concern seams when a resulting file would approach the per-file health budget; no test deleted or skipped.

## Decision ledger

- One sibling module `workflow-runner-resume.ts` owns all three resume machines plus shared promotion helpers; rules out splitting production resume code across multiple modules in this slice.
- Extract all three resume machines plus shared promotion helpers in one behavior-preserving move; rules out leaving any resume block inline in `workflow-runner.ts`.
- Preserve twin settlement implementations unchanged in this slice; rules out merging intent-finalization and review-mutation settlement here.
- Split co-located resume tests along concern seams when a resulting file would approach the per-file health budget; rules out retaining `workflow-runner-resume.test.ts` as one near-budget monolith after the move.
- Record merge-base vs branch test inventory in `workflow-runner-resume-inventory.test.ts`; rules out silent test loss during the move.

## Acceptance criteria

- [ ] `workflow-runner-resume-structure.test.ts` fails if `recoverPlanStage`, `resumePopulatedIntentPublication`, `resumeReviewMutationFinalization`, or `landReviewedPublicationOutput` remain defined in `workflow-runner.ts` (all four are exported inline entrypoints reachable on main today).
- [ ] `workflow-runner-resume-inventory.test.ts` records merge-base vs branch case counts and unchanged titles for every resume-path test moved from `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts`, and `workflow-runner-publication.test.ts`.
- [ ] `bun run test:cost` over each post-move resume test file reports at most 150s wall clock (30s margin under `SUPPORTED_HEALTHY_FILE_BUDGET_MS` = 180_000); the resume-path file stays at most 120s per the 2026-08-25 workflow-runner split contract.
- [ ] `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts`, and `workflow-runner-publication.test.ts` resume-path tests stay green when re-pointed at `workflow-runner-resume.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — module map entries for resume-machine ownership and import boundaries.
- `v2/docs/test-writing.md` — where resume-machine tests live after co-location; note to split before a file approaches the per-file health budget.

## Prerequisites

- Review-debate step landing orchestration lives in a sibling module wired from workflow-runner step dispatch.
