---
name: extract-workflow-runner-resume-machines
---

# Extract workflow-runner resume machines into sibling modules

## Primary implementation surface

Execution loop — plan recovery and publication resume machines in `v2/src/execution/`

## Problem

Plan recovery, intent-finalization resume, and review-mutation resume (~1,600 lines) live inline in `workflow-runner.ts` alongside shared review-landing promotion helpers, blocking review of either seam and keeping resume tests in oversized concern-group files.

## Behavior

Plan recovery, intent-finalization resume, review-mutation resume, and shared review-landing promotion helpers move to named sibling module(s); `workflow-runner.ts` keeps the step loop and imports the exported resume entrypoints. Twin settlement helpers stay separate for now; `resumable` behavior stays as-is until the follow-on merge intent. Co-located tests move with their modules; no test deleted or skipped.

## Decision ledger

- Extract all three resume machines plus shared promotion helpers in one behavior-preserving move; rules out leaving any resume block inline in `workflow-runner.ts`.
- Preserve twin settlement implementations unchanged in this slice; rules out merging intent-finalization and review-mutation settlement here.
- Split co-located resume tests along module seams when a resulting file would approach the per-file health budget; rules out retaining `workflow-runner-resume.test.ts` as one near-budget monolith after the move.
- Record a merge-base vs branch test inventory comparison (count + titles); rules out silent test loss during the move.

## Acceptance criteria

- [ ] `workflow-runner.ts` no longer contains plan recovery, publication resume machines, or shared review-landing promotion helpers; a structural assertion fails if those symbols remain inline.
- [ ] Recorded test inventory comparison proves merge-base and branch counts and titles match.
- [ ] Every post-move resume test file completes with margin under the per-file health budget under load.
- [ ] `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts`, and `workflow-runner-publication.test.ts` resume-path tests stay green when re-pointed at the extracted module(s).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — module map entries for resume-machine ownership and import boundaries.
- `v2/docs/test-writing.md` — where resume-machine tests live after co-location; note to split before a file approaches the per-file health budget.

## Prerequisites

- Review-debate step landing orchestration lives in a sibling module wired from workflow-runner step dispatch.
