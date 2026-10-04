---
name: guard-prevents-git-spawning-bypass
---

# Structural guard prevents new Git/GitHub command spawning in v2 production code

## Problem

After migrating Git and GitHub operations to typed boundaries in `shared/git.ts` and a typed GitHub service, new code could still bypass the boundary by constructing Git or GitHub commands directly (e.g., via `runner.runAsync("git", […])`). A structural guard (linter, test guard, or pre-commit hook) ensures that production code cannot add new bypass sites without explicit permission or documented exception.

## Decisions

- A guard (linter rule, test-time assertion, or guard script) detects direct `git` and `gh` command spawning in v2 production code and reports violations.
- Guard scope: `v2/src/**/*.ts` (not tests, not v1). Root scripts (`scripts/*.ts`) already enforce imports from `shared/git.ts`.
- Violations are fatal in CI or the ready gate, preventing merge of unauthorized bypass code.
- Plan must decide the documented-exception mechanism for the rare legitimate direct spawn (test support, generic subprocess runners).
- Plan must decide: guard mechanism (linter, test assertion, dedicated script), exception syntax and review process, whether root scripts are separately guarded.

## Prerequisites

- `shared/git.ts` offers consolidated Git operation boundary (delivered by: shared-git-operations-boundary)
- Typed GitHub operations boundary exists and supports PR list/view/check merged operations (delivered by: github-operations-boundary)
- Cleanup delegates Git and GitHub operations to typed boundaries (delivered by: cleanup-delegates-to-git-boundary)
- External-worktree operations delegate to shared Git boundary (delivered by: external-worktree-delegates-to-shared)
- Review-implement delegates branch diff to shared boundary (delivered by: review-implement-uses-shared-diff)
- Root scripts delegate Git operations to shared boundary (delivered by: root-scripts-use-shared-git)

## Acceptance criteria

- [x] A guard script or linter rule detects `runAsync("git"` and `runAsync("gh"` patterns in `v2/src/**/*.ts` production code (not tests).
- [x] Running the guard on current main fails (pre-migration code has bypasses); after all migration intents land, the guard passes.
- [x] Guard rejects new `runAsync("git"` or `runAsync("gh"` additions in v2 production files (test verified with a deliberate violation).
- [x] The guard runs from `package.json` `check` like the other `scripts/guard-*.ts` guards.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `AGENTS.md` — note the guard preventing Git/GitHub command construction in v2 production code, exception process.
- `v2/docs/v2-architecture.md` — document the guard as part of the Git operation boundary enforcement.

## Primary implementation surface

- `scripts/guard-git-spawn-bypass.ts` (new guard script, joining the existing `scripts/guard-*.ts` pattern)
- `package.json` `check` script (integrate guard into the pre-commit check sequence)
