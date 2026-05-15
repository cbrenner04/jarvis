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
  using the same base-branch resolution patch mode uses today:
  `getBaseBranch(cwd)` from `src/gh.ts`, which queries
  `gh repo view --json defaultBranchRef`. Reuse it as-is; do not
  reintroduce a `git symbolic-ref refs/remotes/origin/HEAD` fallback.
- **Creation primitive:** reuse `ensureWorktree` from
  `src/worktree.ts` — the same helper patch mode calls from
  `src/modes/patch/run.ts`. Today its signature is
  `ensureWorktree(projectRoot, specPath)` and it derives the spec
  name from the spec path, then uses `<specName>` for **both** the
  directory under `.worktree/` and the branch. Plan mode breaks both
  assumptions (the directory must be `plan-<name>` while the branch
  must be `plan/<name>`), so this subspec adds a sibling entry point
  alongside `ensureWorktree` that takes `{ projectRoot, name,
  baseBranch?, dirPrefix: "plan-", branchPrefix: "plan/" }` (or
  equivalent). The shared internals — `git fetch origin`,
  `branchExistsLocal`/`branchExistsOnOrigin`, the
  `git branch <branch> <base>` + `git worktree add <path> <branch>`
  pair — must be factored so the patch-mode call site is unchanged.
  Do **not** duplicate the entire creation logic.
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

- Patch mode calls `ensureWorktree` from `src/worktree.ts` in
  `src/modes/patch/run.ts` (around line 346). That helper plus
  `createWorktreeSymlinks` (same module) are what to reuse or extend.
- The `<name>` value comes from subspec 02. For this subspec's tests,
  pass `<name>` directly to the helper; integration through the
  command happens in subspec 02.
- Plan mode's call site is `src/commands/plan.ts`, which already
  resolves the project via `enterMode` (`src/mode-entry.ts`) — invoke
  the new helper after `entry.kind === "ok"` and before any stub exit.

## Tasks

- [ ] Add `createPlanWorktree({ projectRoot, name, baseBranch })` (or
  similar) as a new export from `src/worktree.ts`. Factor any internal
  helpers shared with `ensureWorktree` so the patch-mode call site is
  unchanged.
- [ ] Wire it into `planCommand` (`src/commands/plan.ts`) after the
  successful `enterMode` resolution, but do not yet seed any files
  (subspec 03). The existing `PLAN_STUB_MESSAGE` exit at the bottom of
  `planCommand` is replaced by the new code path.
- [ ] Tests:
  - Successful creation produces `.worktree/plan-<name>/` checked out
    on `plan/<name>`.
  - Existing slot causes the documented exit-`1` failure.
  - `worktreeSymlinks` config is applied to the new worktree.
  - Underlying `git worktree add` failure surfaces with the existing
    error wording.

## Acceptance criteria

- [x] `jarvis plan` (file or inline mode, with a placeholder name)
  creates `.worktree/plan-<name>/` on branch `plan/<name>`, off the
  project's default branch.
- [x] No files beyond what `git worktree add` produces are written in
  this subspec.
- [x] Patch-mode worktree creation behavior is unchanged.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
