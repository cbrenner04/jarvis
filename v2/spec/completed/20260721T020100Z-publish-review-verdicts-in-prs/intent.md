---
name: publish-review-verdicts-in-prs
---

# Publish review verdicts in PRs

## Outcome

- A v2 plan or implement PR produced after review includes the final review verdict alongside the reviewed spec.
- The published verdict matches the last completed review cycle, including an empty no-findings verdict.
- Publication retries preserve the same verdict without rerunning review.

## Decisions

- Publish the verdict as the established `verdict-plan.md` or `verdict-patch.md` artifact, not as duplicated PR-body prose; this matches v1's durable review record.
- On the published branch, place plan verdicts at `<spec-dir>/verdict-plan.md` and implementation verdicts at `<spec-dir>/verdict-patch.md`.
- Cover v1-equivalent plan and implement review publication, not reviewed-intent fan-out; v1 has no matching reviewed-intent PR contract.
- Publish only the final cycle's verdict, not every intermediate role artifact or cycle transcript; the established verdict files are overwritten per cycle.

## Acceptance criteria

- [ ] A reviewed plan's published branch exposes its final verdict at `<spec-dir>/verdict-plan.md` for both light and debate review.
- [ ] A reviewed implementation's published branch exposes its final verdict at `<spec-dir>/verdict-patch.md`.
- [ ] The artifact contains the last completed cycle's exact verdict, including an empty verdict when review found no changes.
- [ ] Retrying landing or publication preserves the verdict and does not rerun review.
- [ ] Regression coverage fails against the current reviewed-plan landing behavior and passes after the change.

## Documentation updates

- `v2/docs/workflow-runner.md` — reviewed plan and implement verdict publication.
- `v2/docs/write-behavior.md` — durable verdict lifecycle after successful review.
- `v2/docs/v2-architecture.md` — clarify that the final verdict lands with the reviewed spec.
- `v2/docs/v1-behaviors.md` — record v2 parity for PR-visible review verdicts.

## Prerequisites

- Plan and implement review steps persist their final verdict to `verdict-plan.md` and `verdict-patch.md` respectively.
- Successful reviewed workflows publish completion commits and PRs from their worktrees.
