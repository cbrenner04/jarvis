# Clean up worktree/branch on pre-commit plan failure

## Problem

A `commit: true` plan creates `.worktree/plan-<name>` + branch `plan/<name>` via
`createPlanWorktree` (`v1/src/modes/plan/run.ts:803`). If the run fails **before** the
first `plan: draft` commit — draft agent error / quota / model-config (`:923-941`),
draft validation failure (`:951-976`), a draft-phase exception (`:982-987`), the
boundary-path `commitPlanBlocker` catch (`:1039-1043`, blocker commit itself throws),
or the `commitPlanDraft` catch (`:1076-1079`, draft commit itself throws) — the
worktree and branch leak with nothing committed, forcing manual `git worktree remove` /
`git branch -D`. Only the early `intent.md`-write failure cleans up today, via
`cleanupCommittedTempPlanState` (`:231-256`, called at `:858`).

## Decisions

- Clean up the worktree + branch only on failures that occur **before** the first
  `plan: draft` commit is pushed. Reuse `cleanupCommittedTempPlanState`. Rules out
  cleaning up after a draft commit exists.
- Preserve all resumable blocked states, which differ by phase:
  - Boundary blocker (`:1001-1050`): on a fresh plan this commits a `plan: blocker`
    (`:1017`) and returns **before** any `plan: draft` commit or draft PR exists. The
    pushed blocker commit makes the branch non-empty and resumable, so preserve it.
  - Draft blocker (`:1114-1156`) and any review-phase failure: a `plan: draft` commit
    and open draft PR already exist, so preserve.
  Leave the worktree and branch intact for `--resume` in all of these. Rules out
  treating "blocked" as a failure to clean up — that would destroy resumable work (and,
  for the draft/review paths, the open draft PR).
- Cleanup is gated to `commit: true`. For `commit: false`/`git: false` the run reuses
  `project.root` as its working dir with no plan worktree/branch, so cleanup must never
  run there. Rules out deleting the operator's checkout or an unrelated branch — the
  failure mode flagged in [[plan-git-false-boundary-misfire]].
- SIGINT before the draft commit keeps today's behavior (preserve, no cleanup):
  interrupt is operator-initiated and may precede a deliberate restart. Rules out
  folding Ctrl-C into the cleanup path.

## Task checklist

- [x] Invoke `cleanupCommittedTempPlanState` on each pre-draft-commit failure return
      (commit: true): draft agent error/quota/model-config, validation failure, subspec
      count failure, draft-phase exception, the boundary-path `commitPlanBlocker` catch
      (`:1039`), and the `commitPlanDraft` catch (`:1076`).
- [x] Leave the blocker/PR/review paths and SIGINT untouched.
- [x] Update docs.

## Acceptance criteria

- [x] A `commit: true` plan that fails before any `plan: draft` commit — including the
      blocker-commit and draft-commit throw paths — leaves no `.worktree/plan-<name>`
      directory and no `plan/<name>` branch.
- [x] A `commit: true` plan that reaches the boundary blocked state (a pushed
      `plan: blocker` commit, no `plan: draft` commit and no draft PR yet) preserves its
      worktree and branch for resume — unchanged from current behavior.
- [x] A `commit: true` plan that reaches the draft blocker state (committed `plan: draft`
      and an open draft PR) preserves its worktree and branch for resume — unchanged.
- [x] A `commit: false`/`git: false` plan failure never removes the project checkout or
      deletes a branch.
- [x] Existing plan blocker and resume tests stay green (cleanup added only on the
      pre-commit failure paths).

## Documentation updates

- `v1/docs/plan-mode.md` — drop/adjust the manual `git worktree remove` / `branch -D`
  instructions for failed plans now that cleanup is automatic on pre-commit failure.
- `v2/docs/v1-behaviors.md` — record automatic worktree/branch cleanup on pre-commit
  plan failure and that resumable blocked states are preserved.
