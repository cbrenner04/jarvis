# 01 — Worktree slot and branch creation

## Problem

Plan mode needs its own worktree directory and branch so it can build
up the spec tree in isolation from the user's main checkout and from
any concurrent patch-mode worktree against the same spec name. We add
a dedicated `.worktree/plan-<name>/` slot on a `plan/<name>` branch.
Reuse patch-mode's worktree creation primitives where possible to
minimize divergence and keep `jarvis triage` / `jarvis cleanup` working
with minimal changes (cleanup details land in subspec 06).

## Decisions

- **Path:** `<projectRoot>/.worktree/plan-<name>/`. The `plan-` prefix
  is mandatory; it disambiguates plan and patch slots for the same
  `<name>`.
- **Branch:** `plan/<name>`. Created off the project's default branch
  using the same base-branch resolution patch mode uses (`origin/HEAD`
  symbolic ref, falling back to `origin/main`).
- **Creation primitive:** reuse the existing worktree creation helper
  in `src/worktree.ts` (or wherever patch mode currently calls
  `git worktree add ... -b plan/<name> origin/<base>`). If the helper
  is too coupled to patch-mode assumptions, add a small new entry point
  alongside it; do not duplicate the entire creation logic.
- **Collision policy.** This subspec assumes `<name>` is already
  unique (subspec 02 enforces uniqueness). If the target slot or branch
  somehow exists when this code runs, fail loudly: print `plan worktree
  already exists at <path>; resolve with \`jarvis cleanup\` or remove
  manually` to stderr and exit `1`. Do not auto-suffix here; that is
  subspec 02's responsibility.
- **Worktree contents at end of this subspec:** an empty checkout of
  the `plan/<name>` branch with no plan-specific files added yet. Files
  are seeded by subspec 03.
- **No symlink convention changes.** If the project config has
  `worktreeSymlinks`, apply them to the plan worktree the same way
  patch mode does. Inheriting from the existing helper should give this
  for free.
- **Failure paths.** Any `git` failure (network, permissions) surfaces
  with the existing worktree-creation error wording. The user's main
  checkout is untouched on failure.
- **No agent calls.**

## Implementation hints

- Look for the function patch mode calls in `src/commands/run.ts` to
  prepare its worktree; that is the function to reuse or extend.
- The `<name>` value comes from subspec 02. For this subspec's tests,
  pass `<name>` directly to the helper; integration through the
  command happens in subspec 02.

## Tasks

- [ ] Add `createPlanWorktree({ projectRoot, name, baseBranch })` (or
  similar) — either as a new export from `src/worktree.ts` or by
  parameterizing the existing helper.
- [ ] Wire it into `planCommand` after the skeleton's preflights, but
  do not yet seed any files (subspec 03).
- [ ] Tests:
  - Successful creation produces `.worktree/plan-<name>/` checked out
    on `plan/<name>`.
  - Existing slot causes the documented exit-`1` failure.
  - `worktreeSymlinks` config is applied to the new worktree.
  - Underlying `git worktree add` failure surfaces with the existing
    error wording.

## Acceptance criteria

- [ ] `jarvis plan` (file or inline mode, with a placeholder name)
  creates `.worktree/plan-<name>/` on branch `plan/<name>`, off the
  project's default branch.
- [ ] No files beyond what `git worktree add` produces are written in
  this subspec.
- [ ] Patch-mode worktree creation behavior is unchanged.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
