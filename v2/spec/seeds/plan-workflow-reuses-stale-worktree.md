# Seed: plan workflow reuses a stale worktree instead of materializing from base

## Problem

`jarvis run workflow plan --ready-intent <x>` for a ready-intent whose plan branch (`plan/<name>`)
already exists from a prior session **reuses that stale worktree** (its HEAD weeks old) instead of
recreating it from current `main`. The plan agent then drafts against stale code.

Observed 2026-07-18: planning `stale-daemon-refuses-new-work` reused a `plan/…` worktree at a HEAD
predating the prerequisite it depended on (`daemon-status-source-snapshot`, merged that hour). The
agent correctly appended a `## Blocker` that the prerequisite was absent from committed code —
because its base was stale. The implement preset already resets a stale workspace from `--base`;
the plan preset does not.

Recovery that worked: `git worktree remove --force ~/.jarvis/worktrees/<project>/plan/<name>` +
`git branch -D plan/<name>`, then re-run → materialized fresh at current main.

## Decisions

- Plan preflight resets a stale existing `plan/<name>` worktree from the base branch before the write
  step (parallel to the implement stale-workspace reset), or honors an explicit `--base`.
- A live plan run's worktree is still protected (reset only when not live-held).

## Acceptance criteria

- [ ] `jarvis run workflow plan` for a ready-intent whose `plan/<name>` worktree exists at a stale base
      recreates the worktree from current base before drafting; the drafted spec sees current code.
- [ ] A live plan run for the same name is not reset.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — note plan resets a stale plan worktree from base (remove the manual
  worktree-clear stopgap).
