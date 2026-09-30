---
name: apply-pr-review-feedback-to-a-lane
---

# No jarvis command applies PR review feedback to a lane

## Problem

Once a plan or implement lane has published its PR, there is no jarvis path to act on review feedback — neither GitHub PR review comments nor an operator/subagent review verdict. Every fix after publication is hand-edited on the branch, outside the harness: no run row, no gate, no mutation verification, no telemetry, no attribution trailer.

Evidence (2026-09-29/30 session, all hand-applied): plan PR #4163 (`ResumePipelineOutcome` widening), plan `handoff-rollback-restores-admission-after-handoff-supersede` (4 review defects, #4199), implement #4186 (review-found `reopenStage` closure race), implement #4200 (real-daemon/real-timer test, untested entrypoint wiring), seed PR #4187 (owner's inline review comments → follow-up PR #4192 because the PR had merged). The owner hit the same gap independently in a work repo: no way to update a PR from its review.

## Decisions

- One jarvis entry point takes a lane's open PR plus review input and re-enters the lane's workflow to address it, landing on the same branch/PR through the normal write → gate → publication path. Rules out hand edits as the only route.
- Review input sources: GitHub PR review comments/threads (fetched via `gh`), and an operator-supplied verdict file/text. Plan and implement lanes both supported.
- Works for a finished lane (terminal `completed`) whose PR is still open; a merged PR is out of scope (follow-up PR is a separate lane).
- Addressed feedback is traceable: the run records which comments/verdict items it addressed; unresolved items settle as a named blocker, not silent completion.

## Acceptance criteria

- [ ] A test drives the entry point on a completed implement lane with an open PR and fake review comments; the run commits on the same branch, passes the gate, and pushes to the same PR (fakes for `gh`/agent).
- [ ] The same for a plan lane: the corrected spec tree lands on the plan PR.
- [ ] A merged or closed PR refuses with a named reason.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — addressing review feedback on a published lane.
- `v2/docs/workflow-runner.md` — the review-feedback re-entry.
- `v2/docs/v1-behaviors.md` — new capability.
