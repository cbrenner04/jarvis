---
name: plan-stage-consumes-ready-intent-from-read-source
---

# Plan landing consumes the ready-intent from the source the plan stage actually read

## Problem

Git-chained plan still builds `landing.inputs` against `project.root` while the ready-intent was validated under the prior stage worktree (or another read root). With intent PR unmerged, `consumePublicationInputs` in worktree mode needs the file on both roots; neither has it, so consumption silently no-ops and the queue file survives on `main` after merge. External-home consumption is fixed; in-repo detached handoff is not.

## Decisions

- `landing.inputs` carry the resolved read path and `sourceRoot` where the ready-intent was validated, with `consumeFrom` chosen so deletion targets that source — rules out the both-places-or-silent-skip mechanic and hardcoded `resolve(project.root, relative)`.
- Standalone plan from the project checkout keeps today’s worktree deletion in the plan PR when the ready-intent is already on the plan worktree — rules out breaking `workflow-runner-core.test.ts` `"lands the byte-identical ready intent before consuming plan inputs"`.
- Cleanup `provenIntentPrune` slug lookup is out of scope (carved to `cleanup-prunes-consumed-ready-intent-by-slug`).

## Prerequisites

- External-home ready-intents consume through `consumeFrom: "source"` and canonical absolute paths under the project specs home.
- Plan-tree landing runs `landing.inputs` consumption only after successful durable landing.
- Pipeline plan resolution succeeds when the chained ready-intent exists only on the prior intent worktree, not on `main`.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` adds a case with the ready-intent only on the intent worktree (absent from `main` and from the plan worktree before landing): resolve the plan stage through production builders, land through `landReviewedPublicationOutput`, and assert the ready-intent is deleted from its actual source path; fails against the current silent no-op.
- [ ] `workflow-runner-core.test.ts` test `"lands the byte-identical ready intent before consuming plan inputs"` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — inter-stage handoff and plan consumption match consume-from-actual-source (merge between stages not required; queue file removed at the landing that consumed it).
- `v2/docs/v1-behaviors.md` — record pipeline/standalone plan ready-intent consumption source resolution.
