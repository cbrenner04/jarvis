---
name: implement-completion-commit-runs-formatter
---

# Completion commit formats changed files before staging

Single execution-loop surface (`createCompletionCommitter` / `preparePendingCommit` before `git add -A`); splitting by module boundary does not apply.

## Problem

Implement completion commits agent-authored code without running the project formatter, so the committed tree can fail CI `check` on formatting alone. The operator hand-runs `bun biome check --write` and pushes a follow-up commit. Ready-gate repair autofix does not cover this: it runs only after a red gate post-commit, and several runs blocked or settled before the gate ran.

## Evidence

- 2026-08-05, PR #2604: subprocess-abort test tripped `biome check` (multi-line call biome wanted collapsed); CI red until hand format + push.
- 2026-08-05, PR #2609: `stream_event` write in `agents.test.ts` tripped `biome check` the same way.
- Recurs across agents (cursor and claude write steps both produced unformatted code).

## Decisions

- Run format-only on changed worktree paths in the completion-commit path before `git add -A` — rules out relying on ready-gate repair autofix or operator hand-fix after publish.
- Completion-commit formatting does **not** invoke configured `fixCommand` or built-in `bun run fix` (`check:fix:unsafe`); ready-gate repair autofix keeps existing `fixCommand` / `runFixCommand` semantics — rules out semantic lint autofix on the completion path or conflating the two call sites.
- Built-in default: scoped `bun biome check --write <path…>` on enumerated changed paths (not repo-wide `fix` / `check:fix:unsafe`) — rules out always running the default `fix` script at completion.
- Enumerate changed paths from worktree state before format (`git status --porcelain`, including untracked); pass only those paths to the formatter — rules out formatting the whole tree or only index-staged paths.
- Formatter policy mirrors ready-gate repair autofix where applicable: same `iterationTimeoutMs` budget; non-zero exit or timeout surfaces named `completion_commit_failed` and does not commit unformatted output — rules out best-effort format-then-commit-anyway. Diverge on skip-when-absent: completion formatting does not skip when a package-manager script is missing (biome is the built-in command).
- Distinct from ready-gate repair autofix: this formats the completion commit itself so CI `check` starts clean — rules out conflating the two autofix sites in operator docs.

## Acceptance criteria

- [ ] `completion-commit.test.ts` `"formats changed files before staging so committed tree passes biome check"` seeds an unformatted change, runs the completion-commit path, and asserts the committed tree passes `bun biome check` with no format diff; fails against the pre-fix code.
- [ ] `completion-commit.test.ts` `"surfaces completion_commit_failed when formatter exits non-zero"` drives a failing formatter and asserts a named failure without committing unformatted output; fails against the pre-fix code.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the formatter invocation from the completion-commit path leaves an unformatted change committed and turns the regression RED; pin via a unique-basename test, naming the enclosing test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Commit phase — record format-only invocation on changed paths before `git add -A`, built-in scoped `biome check --write`, and explicit separation from ready-gate `fixCommand` autofix.
- `v2/docs/operator-runbook.md` § Gate trust — add that implement formats the completion commit so CI `check` formatting violations are unlikely without a manual fix; leave the cognitive-complexity bullet intact (it is about non-autofixable lint, not formatting).

## Prerequisites

- The write-loop completion committer stages with `git add -A` at the `preparePendingCommit` boundary in `completion-commit.ts`.
- Ready-gate repair autofix already invokes `runFixCommand` with `fixCommand` resolution, `iterationTimeoutMs`, and skip-when-absent package-manager script semantics (`shared/fix-command.ts`).
- CI `check` (`package.json` `check`) includes `bun biome check .` and fails on formatting violations alone.
