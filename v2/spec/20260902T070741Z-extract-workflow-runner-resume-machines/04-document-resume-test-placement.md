# Document resume test placement

## Problem

`test-writing.md` still describes resume-path coverage only under the pre-extraction `workflow-runner-resume.test.ts` concern-group filename beside `workflow-runner.ts`, with no co-location or split guidance after the production move.

## Surface

Primary: `v2/docs/test-writing.md`.

## Prerequisites

- Subspec 02 complete: resume-path tests co-located beside `workflow-runner-resume.ts`.

## Decision ledger

- Record co-located resume test filenames and the split-before-budget rule in the existing workflow-runner split paragraph; rules out a duplicate standalone section that drifts from the 2026-08-25 split contract.
- Name `workflow-runner-resume-inventory.test.ts` as the merge-base parity guard with `test.each` row expansion; rules out implying manual inventory diff is sufficient.
- Docs-only subspec; rules out `v1-behaviors.md` churn (owned by subspec 03).

## Task checklist

- Update the 2026-08-25 workflow-runner split paragraph to state resume-machine tests live beside `workflow-runner-resume.ts` (and any `workflow-runner-resume-*.test.ts` siblings), with `workflow-runner-resume-inventory.test.ts` pinning moved-case parity across `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts` (`recoverPlanStage`), and `recover-review-failed-plan-draft.test.ts` buckets.
- Add the split-when-cost-exceeds-150s rule (120s primary resume-path file) for co-located resume test files, noting proactive pre-budget splits are deferred until post-move cost is measured.

## Acceptance criteria

- [x] `v2/docs/test-writing.md` documents where resume-machine tests live after co-location, the inventory guard buckets, and the split-when-cost-exceeds per-file health budget rule.

## Documentation updates

- `v2/docs/test-writing.md` — resume-machine test placement after co-location; split when cost exceeds per-file health budget.
