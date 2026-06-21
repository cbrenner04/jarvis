# Plan honors `git: false` as loop-only

## Problem

`jarvis1 plan` against a project resolved to `git: false` cannot complete. Plan
run (`v1/src/modes/plan/run.ts`) never consults `effectiveGit`; it routes solely on
`resolvePlanFlags(...).commit` plus `existsSync(<root>/.git)`. So a `git: false`
project still takes the commit path (worktree `.worktree/plan-<name>`, branch
`plan/<name>`, push), and even the existing `commit: false` path calls
`assertTargetRepoPlanBoundary(project.root)`, which runs `git status` on a root that
happens to carry `.git` (e.g. a git worktree). Net: a false `plan: boundary violation
detected before draft commit`, followed by stray `git checkout -- spec/` and `git push`
cleanup errors.

Patch/run already honor `git: false` loop-only via `gitEnabled = effectiveGit(cfg, …)`
(`v1/src/modes/patch/preflight.ts`); plan must do the same.

This is an unvalidated bug report. First implementation step: reproduce against a
`git: false` project and confirm the loop-only direction before editing — the report's
config description (commit inherited false vs. defaulted true) is ambiguous, and the fix
must hold under both readings.

## Decisions

`git: false` (via `effectiveGit(cfg, project)`) forces plan loop-only: external
`~/.jarvis/specs/<safe-id>/<spec-dir>/`, no worktree/branch/commit/push — overriding any
`plan.commit: true`. — rules out leaving commit-mode active on a git-disabled root (the bug); git is the lower-level capability, so you cannot commit without it.

On a git-disabled root the write boundary is enforced only by the external-spec-dir
check (`assertNoCommitExternalSpecBoundary`, cwd-scoped); the `git status`-based
`assertTargetRepoPlanBoundary` is skipped. — rules out running `git status` on the root and the resulting false-positive / `git checkout -- spec/` failure.

Reuse the existing `commit === false` code path for the git-disabled case (force
`commit = false` after `effectiveGit` resolution) rather than adding a parallel branch. — rules out duplicating no-commit routing and its git-gated cleanup, which would drift.

## Task checklist

- Reproduce: `jarvis1 plan` against a `git: false` project currently misfires the boundary check; capture the failing behavior in a test.
- In plan run, resolve `gitEnabled = effectiveGit(cfg, project)`; when false, force loop-only/no-commit routing.
- Skip the `git status` target-repo boundary check when git is disabled; keep the external-spec-dir check.
- Confirm no git cleanup (revert/push/branch/worktree teardown) runs on a git-disabled run.
- Update `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `jarvis1 plan` against a project resolved to `git: false` completes without a `plan: boundary violation detected` line and writes the spec tree to `~/.jarvis/specs/<safe-id>/<spec-dir>/` (with a `repo:` binding in `index.md`).
- [ ] A `git: false` plan run creates no `.worktree/plan-<name>` directory and no `plan/<name>` branch under the project root.
- [ ] A `git: false` plan run invokes no `git checkout`/revert and no `git push` (no `pathspec 'spec/'`/no-upstream errors); the only boundary enforcement is the external-spec-dir check.
- [ ] An explicit `plan.commit: true` is overridden to loop-only when the resolved project is `git: false`.
- [ ] `git: true` plan runs are unaffected: existing `plan-command.test.ts` and `plan-end-to-end.test.ts` stay green (behavior unchanged for git-enabled projects).
- [ ] Existing `commit: false` behavior on a non-git root stays green: `plan-no-commit-intent-output.test.ts` stays green.

## Documentation updates

- `v1/docs/plan-mode.md`: note that a resolved `git: false` forces loop-only external-spec behavior regardless of `modes.plan.commit`, and that the git-status target-repo boundary check is skipped on git-disabled roots.
- `v2/docs/v1-behaviors.md`: record the changed plan-mode behavior (plan now honors `effectiveGit`; `git: false` ⇒ loop-only external spec, boundary enforced by cwd) under the plan-mode bullets.
