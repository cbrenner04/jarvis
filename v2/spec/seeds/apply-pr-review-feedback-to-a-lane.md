---
name: apply-pr-review-feedback-to-a-lane
---

# No jarvis command applies PR review feedback to a lane

> **Not dispatchable as one seed.** Large additive behavior (likely a new workflow preset). Confirm the shape with the owner, then split into the behavior slices below as separate seeds; do not run intent/plan/pipeline on this file.

## Problem

Once a plan or implement lane has published its PR, there is no jarvis path to act on review feedback — neither GitHub PR review comments nor an operator/subagent review verdict. Every fix after publication is hand-edited on the branch, outside the harness: no run row, no gate, no mutation verification, no telemetry, no attribution trailer.

Evidence (2026-09-29/30 session, all hand-applied): plan PR #4163 (`ResumePipelineOutcome` widening), plan `handoff-rollback-restores-admission-after-handoff-supersede` (4 review defects, #4199), implement #4186 (review-found `reopenStage` closure race), implement #4200 (real-daemon/real-timer test, untested entrypoint wiring), seed PR #4187 (owner's inline review comments → follow-up PR #4192 because the PR had merged). The owner hit the same gap independently in a work repo: no way to update a PR from its review.

## Direction

A jarvis entry point takes a lane's open PR plus review input and re-enters that lane to address it, landing on the same branch and PR through the normal gate; unresolved items settle as a named blocker. Merged or closed PRs are out of scope.

## Candidate slices (each its own seed once the shape is confirmed)

1. **Review input capture** — normalize GitHub PR review threads (`gh`) or an operator verdict file into one durable review artifact attached to the lane. No re-entry yet.
2. **Implement-lane re-entry** — a completed implement lane with an open PR takes that artifact and runs write → gate → publication on the same branch/PR.
3. **Plan-lane re-entry** — same for a published plan lane (corrected spec tree lands on the plan PR).
4. **Traceability** — the run records which review items it addressed; unaddressed items settle as a named blocker.
5. **Operator surface** — the preset/command and pipeline integration (e.g. a review-feedback stage), if wanted.

## Open questions for the owner

- New preset (`jarvis run workflow review-feedback …`) vs a flag on existing `plan`/`implement`?
- Pipeline stage, standalone only, or both?
- Is slice 1 useful alone (e.g. to feed a hand-driven run)?

## Documentation updates

- `v2/docs/operator-runbook.md` — addressing review feedback on a published lane.
- `v2/docs/workflow-runner.md` — the review-feedback re-entry.
- `v2/docs/v1-behaviors.md` — new capability.
