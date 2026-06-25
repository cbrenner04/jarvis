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
A surviving plan worktree is **disposable** only when all hold: local `plan/<name>` has no commits beyond its base branch, no `origin/plan/<name>` exists, no committed `<targetDir>/<timestamp>-<name>` spec dir exists — this rules out unconditional teardown, which would destroy resumable drafted/pushed work the operator should reach via `--resume`.
Base ref for "no commits beyond base" is the merge-base of surviving `plan/<name>` against current HEAD (the re-run's base branch); a re-run has no original-run base in scope, so this resolves it — rules out diffing against an undefined/stale base that flips the check both ways (tearing down real work or stranding scratch).
The committed-spec-dir check strips the timestamp prefix and matches `<targetDir>/<timestamp>-<name>` (mirroring the external-spec-dir collision check), not the unprefixed `<targetDir>/<name>` — corrects a pre-existing miss where the same-name path check never matched this repo's timestamped spec dirs, leaving the sub-check dead-on-arrival. Rules out a never-matching check that would always classify a committed-spec re-run as disposable.
An unknown/unreachable `origin/plan/<name>` result (offline or transient git error) is treated as **non-disposable**, not absent — rules out fail-open classification that would tear down a pushed branch on a flaky network, breaking the preserve-pushed-work guarantee.
An uncommitted/dirty plan worktree (the SIGINT-before-draft-commit headline case) is disposable scratch and is force-removed — makes the destruction a documented contract; rules out reading "no commits beyond base" as preserving uncommitted local edits.
Disposability is evaluated **once** and the verdict threaded to all three consumers (collision-exemption, teardown, recreate), never re-evaluated — rules out TOCTOU divergence where a later re-check disagrees with the first.
Branchless/worktreeless evaluation: an absent `plan/<name>` branch trivially has no commits-beyond-base; an absent worktree is evaluated on the branch alone — rules out leaving "no commits beyond base" undefined when one side is missing.
Non-disposable same-name collisions keep the existing `-2` suffix-bump behavior — rules out erroring/aborting on them and rules out tearing them down.
Reuse the existing `cleanupCommittedTempPlanState` teardown (worktree remove --force + branch -D + spec-dir removal) for the disposable case — rules out a parallel teardown path.
Teardown swallows failures, so the existing actionable worktree-exists message (`plan worktree already exists at <path>; resolve with jarvis1 cleanup or remove manually`) is retained as the partial-teardown fallback — a failed `worktree remove` then surfaces an actionable error, not a confusing downstream creation failure. Rules out dropping the message outright.
Scope: plan `commit: true` only; `createManagedWorktree`'s throw is unchanged and still guards intent/prompt/prompt-mode managed worktrees — plan removes the disposable worktree before calling, so it never hits the throw on the disposable path. Rules out weakening the shared guard.

## Task checklist

- Add a disposable-plan-state predicate, evaluated once: local worktree and/or local branch present; no plan commits beyond the merge-base of `plan/<name>` against current HEAD (absent branch ⇒ trivially none; absent worktree ⇒ evaluate on branch alone); `origin/plan/<name>` absent (treat unknown/unreachable as non-disposable); no committed `<targetDir>/<timestamp>-<name>` spec dir (timestamp-prefix-stripped match). A dirty/uncommitted worktree is disposable.
- In the fresh `commit: true` path, exempt a disposable same-name worktree from the `ensureUniquePlanName` collision bump, then tear it down via `cleanupCommittedTempPlanState` before `createPlanWorktree`; thread the single disposability verdict to all three sites.
- Leave the non-disposable collision path (committed spec dir, remote branch, branch with plan commits, or unknowable remote) on the current suffix-bump behavior.
- Retain the actionable worktree-exists message in the `createPlanWorktree` catch block as the partial-teardown fallback (teardown swallows failures); keep the generic failure message.
- Add tests covering: disposable re-run reuses `<name>` and starts clean (including dirty-worktree scratch); non-disposable (remote branch / committed timestamped spec dir / branch-with-plan-commit / unreachable remote) still bumps to `<name>-2` and preserves the surviving state.

## Acceptance criteria

- [x] A `commit: true` fresh re-run whose only surviving state is a disposable local `plan-<name>` worktree/branch (no plan commits beyond the `plan/<name>`-vs-HEAD merge-base, no `origin/plan/<name>`, no committed `<targetDir>/<timestamp>-<name>`) reuses the same `<name>` — it tears the surviving worktree+branch down and recreates fresh, without manual `jarvis1 cleanup` or `git branch -D`, and without bumping to `<name>-2`.
- [x] The disposable re-run drafts from a clean recreated worktree (no leftover files or commits from the prior attempt).
- [x] A surviving worktree with uncommitted/dirty scratch (SIGINT before the draft commit) and no plan commits beyond base classifies disposable and is force-removed and recreated under the same `<name>`.
- [x] "No plan commits beyond base" is evaluated against the merge-base of surviving `plan/<name>` and current HEAD; a branch with one plan commit beyond that merge-base classifies non-disposable.
- [x] A committed `<targetDir>/<timestamp>-<name>` spec dir (timestamp-prefixed) blocks teardown — the run classifies non-disposable and bumps to `<name>-2` despite the unprefixed `<name>` not literally matching.
- [x] When `origin/plan/<name>` cannot be determined (offline/transient git error), the run classifies non-disposable and does not tear down the local branch.
- [x] A surviving `plan-<name>` carrying a committed plan commit beyond base, a pushed `origin/plan/<name>`, an unreachable remote, or a committed `<targetDir>/<timestamp>-<name>` spec dir is not torn down: the run keeps current collision behavior (suffix bump to `<name>-2`) and the surviving state is preserved.
- [x] A failed teardown leaves the existing actionable worktree-exists message (`... resolve with jarvis1 cleanup or remove manually`) surfacing on the subsequent creation, not a generic failure.
- [x] `plan-worktree.test.ts` "fails if worktree already exists at the target path" stays green (the `createManagedWorktree` self-guard throw is unchanged).
- [x] `plan-command.sandbox-unrunnable.test.ts` git:false collision test stays green (git:false naming path unchanged by this scope).

## Documentation updates

- `v1/docs/plan-mode.md`: update the uniqueness-suffix-loop description (and the worktree-creation section) to note that a disposable same-name plan worktree/branch is self-healed (torn down + recreated under the same name) on a `commit: true` fresh re-run, while non-disposable state still bumps to `-2`.
- `v1/docs/worktrees-and-commits.md`: in "Plan-mode worktrees", document the self-heal-on-re-run behavior and the disposable-vs-resumable distinction.
- `v2/docs/v1-behaviors.md`: add the self-heal behavior to the plan `commit: true` worktree-creation/collision entries (changing existing v1 behavior).
