# Plan honors `git: false` as loop-only

## Problem

`jarvis1 plan` against a project resolved to `git: false` cannot complete. Plan
run (`v1/src/modes/plan/run.ts`) never consults `effectiveGit`; it routes solely on
`resolvePlanFlags(...).commit`. So a `git: false` project still takes the **commit
path** (worktree `.worktree/plan-<name>`, branch `plan/<name>`, push) — and the reported
symptoms confirm that path: the `.worktree/plan-<name>` dir, the `plan/<name>` branch, the
no-upstream `git push`, and the `git checkout -- spec/` revert are all reachable only
under commit mode (the revert fires only inside `if (commit)`).

Load-bearing remedy: once the project resolves to `git: false`, force `commit = false`,
which neutralizes the worktree/branch/push/revert by routing through the no-commit path.
A secondary guard covers the `commit === false` reading of the evidence: that path calls
`assertTargetRepoPlanBoundary(project.root)`, which runs `git status` on a root that
happens to carry `.git` (e.g. a git worktree, where `.git` is a file) and can itself
false-positive `plan: boundary violation detected before draft commit`; skip it when git
is disabled.

Patch/run already honor `git: false` loop-only via `gitEnabled = effectiveGit(cfg, …)`
(`v1/src/modes/patch/preflight.ts`); plan must do the same.

This is an unvalidated bug report. First implementation step: reproduce against a
`git: false` project and confirm the loop-only direction before editing — the report's
config description (commit inherited false vs. defaulted true) is ambiguous, and the fix
must hold under both readings. The reproduce root is a git **worktree**, where `.git` is a
file, so an `existsSync(<root>/.git)` short-circuit does not catch it — the gate must key
on `effectiveGit`, not `.git` presence.

## Decisions

`git: false` (via `effectiveGit(cfg, <project-key>)` — the helper takes the project key
string, not a `Project` object; passing the object lookups undefined and silently falls
back to global `git`) forces plan loop-only: external `~/.jarvis/specs/<safe-id>/<spec-dir>/`,
no worktree/branch/commit/push — overriding any `plan.commit: true`. — rules out leaving
commit-mode active on a git-disabled root (the bug); git is the lower-level capability, so
you cannot commit without it.

The `git: false` ⇒ `commit = false` override applies at both fresh-run and `--resume`
resolution. — rules out resume re-reading its own `commit` value and mis-resolving a
`git: false` spec to the worktree location.

On a git-disabled root the write boundary is enforced only by the external-spec-dir
check (`assertNoCommitExternalSpecBoundary`, cwd-scoped); the `git status`-based
`assertTargetRepoPlanBoundary` is skipped. — rules out running `git status` on the root and the resulting false-positive / `git checkout -- spec/` failure.

The loop-only behavior holds across both the draft and multi-pass review phases: each
selects `commit ? assertPlanWriteBoundary : assertTargetRepoPlanBoundary` with its own
revert/`git checkout`/`git clean` cleanup, so both must route through the forced
`commit = false`. — rules out fixing only the draft call site and regressing when a
git-disabled run enters review.

Reuse the existing `commit === false` code path for the git-disabled case (force
`commit = false` after `effectiveGit` resolution) rather than adding a parallel branch. — rules out duplicating no-commit routing and its git-gated cleanup, which would drift.

## Task checklist

- Reproduce: `jarvis1 plan` against a `git: false` project (root is a git worktree, so `.git` is a file an `existsSync` short-circuit misses) currently misfires the boundary check; capture the failing behavior in a test.
- In plan run, resolve `gitEnabled = effectiveGit(cfg, <project-key>)` (project key string, not the `Project` object); when false, force loop-only/no-commit routing.
- Apply the same `commit = false` override at `--resume` resolution.
- Skip the `git status` target-repo boundary check when git is disabled, in both draft and review phases; keep the external-spec-dir check.
- Confirm no git cleanup (revert/push/branch/worktree teardown) runs on a git-disabled run through draft or review.
- Update `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md`.

## Out of scope

- The summary `spec:` line printing `spec/<name>/index.md` rather than the external path is the existing shape for all no-commit runs, not a `git: false`-specific symptom; changing it is broader behavior.

## Acceptance criteria

- [ ] `jarvis1 plan` against a project resolved to `git: false` completes without a `plan: boundary violation detected` line and writes the spec tree to `~/.jarvis/specs/<safe-id>/<spec-dir>/` (with a `repo:` binding in `index.md`).
- [ ] A `git: false` plan run creates no `.worktree/plan-<name>` directory and no `plan/<name>` branch under the project root.
- [ ] A `git: false` plan run invokes no `git checkout`/revert and no `git push` (no `pathspec 'spec/'`/no-upstream errors); the only boundary enforcement is the external-spec-dir check.
- [ ] An explicit `plan.commit: true` is overridden to loop-only when the resolved project is `git: false`, at both fresh-run and `--resume` resolution.
- [ ] A `git: false` run that survives draft and enters multi-pass review produces no boundary violation and no stray git calls in the review phase (the review-phase boundary call site is guarded too, not just draft).
- [ ] `git: true` plan runs are unaffected: existing `plan-command.test.ts` and `plan-end-to-end.test.ts` stay green (behavior unchanged for git-enabled projects).
- [ ] Existing `commit: false` behavior on a non-git root stays green: `plan-no-commit-intent-output.test.ts` stays green.

## Documentation updates

- `v1/docs/plan-mode.md`: note that a resolved `git: false` forces loop-only external-spec behavior regardless of `modes.plan.commit`, and that the git-status target-repo boundary check is skipped on git-disabled roots.
- `v2/docs/v1-behaviors.md`: record the changed plan-mode behavior (plan now honors `effectiveGit`; `git: false` ⇒ loop-only external spec, boundary enforced by cwd) under the plan-mode bullets.
