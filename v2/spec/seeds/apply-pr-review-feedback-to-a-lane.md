---
name: apply-pr-review-feedback-to-a-lane
---

# No jarvis command applies PR review feedback to a lane

> Large additive behavior (a new workflow preset); shape confirmed by the owner 2026-09-30. Dispatch as one seed: the intent split must produce one ready-intent per slice below (with prerequisites between them). The operator rejects the `approve-intent` gate if slices are merged or drift.

## Problem

Once a plan or implement lane has published its PR, there is no jarvis path to act on review feedback — neither GitHub PR review comments nor an operator/subagent review verdict. Every fix after publication is hand-edited on the branch, outside the harness: no run row, no gate, no mutation verification, no telemetry, no attribution trailer.

Evidence (2026-09-29/30 session, all hand-applied): plan PR #4163 (`ResumePipelineOutcome` widening), plan `handoff-rollback-restores-admission-after-handoff-supersede` (4 review defects, #4199), implement #4186 (review-found `reopenStage` closure race), implement #4200 (real-daemon/real-timer test, untested entrypoint wiring), seed PR #4187 (owner's inline review comments → follow-up PR #4192 because the PR had merged). The owner hit the same gap independently in a work repo: no way to update a PR from its review.

## Direction

A standalone preset that runs only against a **completed plan or implement lane** — bare workflow or pipeline stage alike — whose PR is still open, and does exactly one thing: address the review feedback on that PR, committing to the same branch and PR through the normal gate. Merged or closed PRs and lanes still in flight are refused with a named reason.

## Slices (one ready-intent each)

0. **Non-pipeline preset** — the preset registry can mark a preset not pipeline-eligible, and pipeline definitions refuse it by name.
1. **Review input capture** — read the PR's review threads/comments (`gh`) into one durable review artifact for the stage. The PR is the only feedback source.
2. **Admission** — resolve a completed plan/implement lane (bare workflow or pipeline stage) to its branch, worktree, and open PR; refuse everything else by name.
3. **Feedback run** — the preset's write step addresses the captured items on the same branch, then gate and publication to the same PR.
4. **Traceability** — the run records which review items it addressed; items it could not address are reported by name, not silently dropped.

## Decided

- **A new workflow preset, not a flag on `plan`/`implement`** (owner, 2026-09-30).
- **Strictly PR feedback.** The agent addresses the PR's review feedback and nothing else: no acceptance-criteria ticking, no subspec routing, no index edits, no new scope. It reuses only the plan/implement rules needed to understand what the PR is (spec layout, what the lane built).
- **Its prompts are its own and need care.** A dedicated `prompts/<preset>/` set that embeds only that context from plan/implement; follow the plan-prompt coherence rules (no numbers in prompts, no restated mechanics) and give every registered prompt render-observer coverage.
- **Runs only on a completed lane**, whether a bare workflow or a pipeline stage (owner, 2026-09-30).
- **Standalone only, never a pipeline stage** (owner, 2026-09-30). Every workflow preset today is pipeline-composable, so this is a new paradigm: if it lands as a preset, the preset registry needs a way to mark a preset not pipeline-eligible, and pipeline definitions must refuse it. Rules out a review-feedback pipeline stage.

## Documentation updates

- `v2/docs/operator-runbook.md` — addressing review feedback on a published lane.
- `v2/docs/workflow-runner.md` — the review-feedback re-entry.
- `v2/docs/v1-behaviors.md` — new capability.
