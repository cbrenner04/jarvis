---
name: populated-stage-is-recoverable-without-hand-copying
---

# A failed intent run with a populated stage is recoverable without hand-copying

## Problem

When intent finalization fails with finished work in `.jarvis-intent-stage/`, the operator's only
recovery on 2026-07-24 was `find` in the worktree plus hand-copying files (PR #2109). The failed
rows offered nothing: `02a33351` reported `unsupported_resume_context` with `nextAction: "stop"`,
so `jarvis run resume` refused, and no other command promotes an existing stage.

## Decisions

- A failed intent run whose stage is populated is recoverable without re-invoking the split or
  review agents: either `run resume` promotes the existing stage, or the failed row names a
  command that does. Rules out `unsupported_resume_context` / `nextAction: "stop"` as the terminal
  answer when finished work is on disk.
- Recovery completes publication (promotion, cleanup, commit, push, PR), not just the file copy —
  rules out leaving the operator a committed stage and no PR.
- Out of scope: recovery for runs whose stage is empty or absent.

## Acceptance criteria

- [ ] A test drives an intent run to a finalization failure with a populated stage, then asserts
      the documented recovery command promotes the stage to `ready-intents/`, cleans up the stage
      and verdict sidecars, and completes publication without invoking any split or review agent;
      it fails against the pre-fix code.
- [ ] A test asserts the failed row for that run does not settle `unsupported_resume_context` /
      `nextAction: "stop"`, and instead surfaces the recovery path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — how to recover an intent run that failed with a
  populated stage.
- `v2/docs/workflow-runner.md` — resume/recovery semantics for a populated intent stage.
- `v2/docs/v1-behaviors.md` — record the changed resume-gating behavior.

## Prerequisites

- Intent finalization promotes `.jarvis-intent-stage/*.md` to `ready-intents/`, removes the stage and verdict sidecars, and commits.
- A post-invocation finalization failure settles with an error naming the finalization step rather than `invocation_failure`.
