---
name: implement-completion-commit-runs-formatter
---

# Completion commit formats changed files before staging

Single execution-loop surface (`createCompletionCommitter` / `preparePendingCommit` before `git add -A`); splitting by module boundary does not apply.

## Problem

Implement completion commits agent-authored code without running the project formatter, so the committed tree can fail CI `check` on formatting alone. The operator hand-runs `bun run fix` / `bun biome check --write` and pushes a follow-up commit. Ready-gate repair autofix does not cover this: it runs only after a red gate post-commit, and several runs blocked or settled before the gate ran.

## Evidence

- 2026-08-05, PR #2604: subprocess-abort test tripped `biome check` (multi-line call biome wanted collapsed); CI red until hand format + push.
- 2026-08-05, PR #2609: `stream_event` write in `agents.test.ts` tripped `biome check` the same way.
- Recurs across agents (cursor and claude write steps both produced unformatted code).

## Decisions

- Run the project formatter on changed worktree paths in the completion-commit path before `git add -A` — rules out relying on ready-gate repair autofix or operator hand-fix after publish.
- Resolve command from configured `fixCommand` when set, else built-in `bun run fix` / `bun biome check --write` scoped to changed files — rules out always running repo-wide `check:fix:unsafe` with semantic lint autofixes.
- Scope is format-only; do not run lint autofixes that change semantics — rules out invoking the default `fix` script (`check:fix:unsafe`) on the completion path.
- A formatter invocation that exits non-zero surfaces a named `completion_commit_failed` (or equivalent) failure and does not commit unformatted output — rules out best-effort format-then-commit-anyway.
- Distinct from ready-gate repair autofix: this formats the completion commit itself so CI `check` starts clean — rules out conflating the two autofix sites in operator docs or shared call sites.

## Acceptance criteria

- [ ] The implement completion-commit path runs the formatter on changed files before `git add -A`; a regression seeds an unformatted change and asserts the committed tree passes `bun biome check` (no format diff).
- [ ] A formatter command that exits non-zero surfaces a named failure rather than committing unformatted; a regression covers the failing-formatter path.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the formatter invocation from the completion-commit path leaves an unformatted change committed and turns the regression RED; pin via a unique-basename test, naming the enclosing test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — record that implement now formats the completion commit, so a green implement PR passes CI `check` without a manual format; retire or narrow the 2026-08-05 "Implement does not run biome" stopgap when it no longer holds.

## Prerequisites

- The write-loop completion committer stages with `git add -A` at the `preparePendingCommit` boundary in `completion-commit.ts`.
- Registered projects may supply a `fixCommand`; when unset, harness code resolves built-in `bun run fix` / biome write semantics via shared fix-command helpers.
- CI `check` (`package.json` `check`) includes `bun biome check .` and fails on formatting violations alone.
