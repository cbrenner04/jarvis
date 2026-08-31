# Pipeline resume re-resolves chained downstream input only from the prior worktree, so clearing that worktree permanently strands the lane

## Problem

`jarvis pipeline resume` of a blocked/failed chained stage re-runs stage resolution, and chained resolution reads the downstream input (e.g. the plan stage's ready-intent `spec/ready-intents/<name>.md`) **from the prior stage's on-disk worktree** (`selectChainedStageCwd` hands the prior workspace path to the stage builder). When that prior worktree is gone, resolution fails with `pipeline-stage-resolve: downstream input <path> not found in prior worktree` before dispatch — even though the input is durably committed on the prior stage's branch / PR / project `main`.

This compounds catastrophically with the dirty-reuse refusal ([[pipeline-resume-clears-blocked-lane-dirty-worktree]]):

1. `pipeline resume <id> <branch-key>` on a blocked lane refuses on the lane's own **dirty worktree** (no reset flag).
2. The documented workaround is to remove the worktree/branch by hand (`cleanup --abandon` or manual `git worktree remove`).
3. `pipeline resume` again now fails `not found in prior worktree` — the worktree deletion that cleared bug (1) removed the only place resolution looks. The lane is now unrecoverable in-pipeline; the operator must abandon the pipeline lanes and re-drive each ready-intent as a standalone `plan`/`implement` (which reads the input from the operator cwd / `main`, not the prior worktree).

So the two bugs together make chained-lane recovery a dead end: the only workaround for the dirty gate permanently breaks resume.

## Evidence (2026-08-31, operator)

`chess-mvp-yolo` `fast` pipeline (seed `05-game-end-resign-undo-and-history`, pipeline `14df5abc`): intent split into 3 lanes; one lane (`board-game-end-orchestration`) planned + implemented, two lanes (`board-game-end-presentation`, `game-end-navigation-and-home-win-rate`) failed at plan stage-resolve. `pipeline resume <branch-key>` on the two blocked lanes failed before start twice — first on dirty worktrees, then (after the operator removed the worktrees/branches) on `pipeline-stage-resolve: downstream input spec/ready-intents/board-game-end-orchestration.md not found in prior worktree`. All three ready-intents were durably present on chess `main` (intent PR #32 merged) the entire time.

## Decisions

- Chained-stage resolution must resolve a downstream input from the **durable landed artifact** when the prior stage's worktree is absent: read the input from the prior stage branch (recorded on the prior stage artifact) or the project base, not solely the on-disk prior worktree. Rules out a resolution path that fails-hard the moment a worktree is cleaned. Sequence with / fold into the [[pipeline-dispatch-shares-cli-front-door]] retirement of `selectChainedStageCwd` — the front-door work already treats prior-stage output resolution as a first-class case.
- `pipeline resume` of a stage whose worktree is gone should rematerialize from base (like an incomplete re-run) and re-resolve inputs from the durable artifact, rather than refusing pre-dispatch. Rules out requiring the prior worktree to survive for recovery to be possible.
- If a downstream input genuinely cannot be found anywhere durable (never landed), the refusal must name that — distinct from "the worktree was cleaned" — and point at standalone re-drive. Rules out a single opaque `not found in prior worktree` for two very different states.

## Acceptance criteria

- [ ] A daemon/pipeline test proves `pipeline resume` of a chained plan (and implement) stage whose prior-stage worktree has been removed resolves its downstream input from the durable prior-stage branch / base and dispatches, instead of failing `not found in prior worktree`; it fails against the prior-worktree-only resolver.
- [ ] A test proves a downstream input that was never landed anywhere durable refuses with a distinct, named reason that points at standalone re-drive, not the generic prior-worktree message.
- [ ] Existing chained-stage resolution behavior (prior worktree present) is unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume recovers chained inputs from the durable landed artifact; clearing a stage worktree (the dirty-gate workaround) no longer strands resume. Update the pipeline-recovery and stage-resolve sections.
- `v2/docs/pipeline-execution.md` — chained downstream-input resolution falls back from prior worktree to durable artifact.

## Sequencing

P1 — pairs with [[pipeline-resume-clears-blocked-lane-dirty-worktree]] (the two are the compounding halves of the same recovery dead-end) and is subsumed by the [[pipeline-dispatch-shares-cli-front-door]] / `selectChainedStageCwd` retirement. Fix the dirty-gate half and this half together, or the workaround for one keeps breaking the other.
