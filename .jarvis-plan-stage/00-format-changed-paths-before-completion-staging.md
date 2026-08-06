# Format changed paths before completion staging

Implement completion commits agent-authored code without running the formatter, so
the committed tree can fail CI `check` on formatting alone. Ready-gate repair autofix
runs only after a red gate post-commit and does not cover the completion-commit path.

## Decision ledger

- Run format-only in `preparePendingCommit` after path enumeration and **before** `git add -A` — rules out relying on ready-gate repair autofix or operator hand-fix after publish.
- Completion-commit formatting does **not** call configured `fixCommand` or built-in `bun run fix` (`check:fix:unsafe`); ready-gate repair autofix keeps existing `runFixCommand` semantics — rules out semantic lint autofix on the completion path or conflating the two call sites.
- Built-in default: scoped `bun biome check --write <path…>` on enumerated changed paths — rules out repo-wide `fix` / `check:fix:unsafe` at completion.
- Enumerate changed paths from worktree state via `git status --porcelain` (including untracked); pass only those paths to the formatter — rules out formatting the whole tree or only index-staged paths.
- Formatter timeout binds to the same `iterationTimeoutMs` budget as ready-gate repair autofix (`args.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS` at call sites) — rules out a separate completion-format timeout.
- Non-zero exit or timeout fails closed: no `git add -A`, no completion commit; write-loop maps the error to retryable `completion_commit_failed` — rules out best-effort format-then-commit-anyway.
- Completion formatting does not skip when a package-manager script is absent (biome is the built-in command, not `bun run <script>`) — rules out ready-gate skip-when-absent semantics on this path.
- Distinct from ready-gate repair autofix in operator docs: completion formatting makes the commit itself CI-check-clean; repair autofix runs only on a red gate after publish — rules out conflating the two sites in prose.
- Deferred to first consumer: exact timeout/threading seam on `createCompletionCommitter` vs `CompletionCommitInput` — pin when call sites are wired.

## Prerequisites

- `preparePendingCommit` stages with `git add -A` at the completion-commit boundary (`v2/src/execution/completion-commit.ts`).
- Ready-gate repair autofix invokes `runFixCommand` with `fixCommand` resolution, `iterationTimeoutMs`, and skip-when-absent package-manager script semantics (`shared/fix-command.ts`).
- CI `check` includes `bun biome check .` and fails on formatting violations alone (`package.json`).

## Work

- Enumerate changed worktree paths before staging in `preparePendingCommit`.
- Run scoped `bun biome check --write` on those paths; fail closed on non-zero exit or timeout.
- Thread `iterationTimeoutMs` from write-loop / workflow-runner completion committer call sites.
- Add regressions and mutation checkpoint in `v2/src/execution/completion-commit.test.ts`.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `completion-commit.test.ts` test `formats changed files before staging so committed tree passes biome check` seeds an unformatted change, runs the completion-commit path, and asserts the committed tree passes `bun biome check` with no format diff; fails against the pre-fix code.
- [ ] `completion-commit.test.ts` test `surfaces completion_commit_failed when formatter exits non-zero` drives a failing formatter and asserts a named failure without committing unformatted output; fails against the pre-fix code.
- [ ] `completion-commit.test.ts` test `formats changed files before staging so committed tree passes biome check` links `// @mutate` removing the formatter invocation from the completion-commit path; inverting leaves an unformatted change committed and turns the regression red.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Commit phase — format-only on enumerated changed paths before `git add -A`, built-in scoped `bun biome check --write`, explicit separation from ready-gate `fixCommand` autofix.
- `v2/docs/operator-runbook.md` § Gate trust — implement formats the completion commit so CI `check` formatting violations are unlikely without a manual fix; leave the cognitive-complexity bullet intact.
- `v2/docs/v1-behaviors.md` — record v2 completion-commit format-only pass (scoped biome on changed paths, before staging; not `fixCommand`; distinct from ready-gate repair autofix).
