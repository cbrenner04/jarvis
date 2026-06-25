# Self-heal disposable plan worktree on commit:true fresh re-run

## Problem

A `commit: true` fresh plan re-run does not recover cleanly when its
`plan-<name>` worktree/branch survives a prior interrupted attempt (SIGINT
before the draft commit, or a blocker that left no commits). Today
`ensureUniquePlanName` (`v1/src/modes/plan/run.ts`) treats the surviving
`.worktree/plan-<name>` as a name collision and silently bumps the run to
`<name>-2`, orphaning the prior worktree+branch; and `createManagedWorktree`
(`v1/src/worktree.ts`) throws `plan worktree already exists at <path>; resolve
with jarvis1 cleanup or remove manually` on the same-name path. Either way the
operator must hand-remove the worktree (and sometimes the branch) to retry the
same intent.

Make the re-run self-healing: when the only surviving state is a **disposable**
local plan worktree/branch, reuse the same `<name>` by tearing it down and
recreating fresh, so a friction-blocked/interrupted attempt re-runs without
hand-cleanup.

## Decisions

Self-heal is the default; no `--retry`/`--fresh` flag — a flag re-imposes the manual-cleanup friction the intent removes, and self-heal only disposes reproducible local scratch state.
Teardown + recreate, not reuse-in-place reset — in-place reuse would have to scrub branch tip, dirty tree, and any stale spec dir; recreating fresh off base is fewer steps and less failure surface.
A surviving plan worktree is **disposable** only when all hold: local `plan/<name>` has no commits beyond its base branch, no `origin/plan/<name>` exists, no committed `<targetDir>/<name>` spec dir exists — this rules out unconditional teardown, which would destroy resumable drafted/pushed work the operator should reach via `--resume`.
Non-disposable same-name collisions keep the existing `-2` suffix-bump behavior — rules out erroring/aborting on them and rules out tearing them down.
Reuse the existing `cleanupCommittedTempPlanState` teardown (worktree remove --force + branch -D + spec-dir removal) for the disposable case — rules out a parallel teardown path.
Scope: plan `commit: true` only; `createManagedWorktree`'s throw is unchanged and still guards intent/prompt/prompt-mode managed worktrees — plan removes the disposable worktree before calling, so it never hits the throw. Rules out weakening the shared guard.

## Task checklist

- Add a disposable-plan-state predicate (local worktree and/or local branch present; no plan commits beyond base; no `origin/plan/<name>`; no committed `<targetDir>/<name>`).
- In the fresh `commit: true` path, exempt a disposable same-name worktree from the `ensureUniquePlanName` collision bump, then tear it down via `cleanupCommittedTempPlanState` before `createPlanWorktree`.
- Leave the non-disposable collision path (committed spec dir, remote branch, or branch with plan commits) on the current suffix-bump behavior.
- Drop/repoint the now-unreachable worktree-exists special-case message in the `createPlanWorktree` catch block in `run.ts` if it becomes dead for the disposable path; keep the generic failure message.
- Add tests covering: disposable re-run reuses `<name>` and starts clean; non-disposable (remote branch / committed spec dir / branch-with-plan-commit) still bumps to `<name>-2` and preserves the surviving state.

## Acceptance criteria

- [ ] A `commit: true` fresh re-run whose only surviving state is a disposable local `plan-<name>` worktree/branch (no plan commits beyond base, no `origin/plan/<name>`, no committed `<targetDir>/<name>`) reuses the same `<name>` — it tears the surviving worktree+branch down and recreates fresh, without manual `jarvis1 cleanup` or `git branch -D`, and without bumping to `<name>-2`.
- [ ] The disposable re-run drafts from a clean recreated worktree (no leftover files or commits from the prior attempt).
- [ ] A surviving `plan-<name>` carrying a committed plan commit on the branch beyond base, or a pushed `origin/plan/<name>`, or a committed `<targetDir>/<name>` spec dir is not torn down: the run keeps current collision behavior (suffix bump to `<name>-2`) and the surviving state is preserved for `--resume`.
- [ ] `plan-worktree.test.ts` "fails if worktree already exists at the target path" stays green (the `createManagedWorktree` self-guard throw is unchanged).
- [ ] `plan-command.sandbox-unrunnable.test.ts` git:false collision test stays green (git:false naming path unchanged by this scope).

## Documentation updates

- `v1/docs/plan-mode.md`: update the uniqueness-suffix-loop description (and the worktree-creation section) to note that a disposable same-name plan worktree/branch is self-healed (torn down + recreated under the same name) on a `commit: true` fresh re-run, while non-disposable state still bumps to `-2`.
- `v1/docs/worktrees-and-commits.md`: in "Plan-mode worktrees", document the self-heal-on-re-run behavior and the disposable-vs-resumable distinction.
- `v2/docs/v1-behaviors.md`: add the self-heal behavior to the plan `commit: true` worktree-creation/collision entries (changing existing v1 behavior).
