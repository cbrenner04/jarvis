# Format changed paths before completion staging

Implement completion commits agent-authored code without running the formatter, so
the committed tree can fail CI `check` on formatting alone. Ready-gate repair autofix
runs only after a red gate post-commit and does not cover the completion-commit path.

## Decision ledger

- Format in `preparePendingCommit` after path enumeration and **before** `git add -A` — rules out relying on ready-gate repair autofix or operator hand-fix after publish. This seam serves every committer invocation (per-iteration checkpoint commits, terminal completion, ready-gate repair re-commits); intentional single-surface choice — primary motivation is CI `check` on the completion commit; iteration/repair scoped formatting is accepted overhead.
- Completion-commit formatting does **not** call configured `fixCommand` or built-in `bun run fix` (`check:fix:unsafe`); ready-gate repair autofix keeps existing `runFixCommand` semantics — rules out semantic lint autofix on the completion path or conflating the two call sites.
- Built-in default: invoke Biome directly as scoped `bun biome check --write <path…>` on enumerated changed paths (not package-manager script resolution) — rules out repo-wide `fix` / `check:fix:unsafe` at completion. Primary target is Jarvis-shaped repos whose CI `check` includes Biome; worktrees without a usable `biome` fail closed (commit blocked), not skip-when-absent.
- Enumerate changed paths via `git status --porcelain --untracked-files=all`; parse with the `pathFromPorcelainLine` pattern (`review-intent-enforcement.ts`: rename `->` handling, no aggregate `slice(3).trim()`) — rules out `getUncommittedPaths` in `write-loop.ts` and formatting the whole tree or only index-staged paths.
- When porcelain yields no paths, skip the format invocation and proceed to existing staging logic — rules out accidental repo-wide Biome or spurious failure on clean/no-op trees.
- Thread `iterationTimeoutMs` through `CompletionCommitInput`; callers pass `args.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS` (write-loop, workflow-runner) — rules out a hardcoded default or separate completion-format timeout.
- Formatter timeout binds to injected `iterationTimeoutMs` with fail-closed semantics matching ready-gate repair autofix — rules out best-effort format-then-commit-anyway.
- Non-zero exit, timeout, or missing Biome throws from `preparePendingCommit` before `git add -A` — no commit, no unformatted output staged. Callers map throws to `iteration_commit_failed` (iteration checkpoints) or `completion_commit_failed` (terminal/publication); this spec does not add write-loop outcome mapping — rules out asserting a single named loop outcome at the committer seam.
- Completion formatting does not skip when a package-manager script is absent (Biome is invoked directly, not `bun run <script>`) — rules out ready-gate skip-when-absent semantics on this path.
- Distinct from ready-gate repair autofix in operator docs: completion formatting makes the commit itself CI-check-clean; repair autofix runs only on a red gate after publish — rules out conflating the two sites in prose.

## Prerequisites

- `preparePendingCommit` stages with `git add -A` at the completion-commit boundary (`v2/src/execution/completion-commit.ts`).
- Ready-gate repair autofix invokes `runFixCommand` with `fixCommand` resolution, `iterationTimeoutMs`, and skip-when-absent package-manager script semantics (`shared/fix-command.ts`).
- CI `check` includes `bun biome check .` and fails on formatting violations alone (`package.json`).

## Work

- Enumerate changed worktree paths in `preparePendingCommit` via `--untracked-files=all` porcelain and `pathFromPorcelainLine` parsing (reuse or extract shared helper).
- When paths are non-empty, run scoped `bun biome check --write` on those paths; fail closed on non-zero exit or timeout; skip when empty.
- Extend `CompletionCommitInput` with `iterationTimeoutMs`; pass from write-loop and workflow-runner committer call sites.
- Extend `completion-commit.test.ts` from fake-git/mocked `runGit` fixtures to real `git init` worktrees, real Biome subprocess, and post-commit `bun biome check` — not mocks that preserve pre-fix ordering.
- Add regressions and `// @mutate` mutation checkpoint in `v2/src/execution/completion-commit.test.ts`.
- Update durable docs listed below.

## Acceptance criteria

- [x] `completion-commit.test.ts` test `formats changed files before staging so committed tree passes biome check` seeds an unformatted change in a real worktree, runs the completion-commit path with real Biome, and asserts the committed tree passes `bun biome check` with no format diff; fails against the pre-fix code.
- [x] `completion-commit.test.ts` test `throws before staging when formatter exits non-zero` drives a failing formatter and asserts `preparePendingCommit` throws with no `git add -A` and no unformatted output committed; fails against the pre-fix code.
- [x] `completion-commit.test.ts` test `throws before staging when formatter times out` drives a formatter that exceeds injected `iterationTimeoutMs` and asserts throw with no unformatted output committed; fails against the pre-fix code.
- [x] `completion-commit.test.ts` test `honors injected iterationTimeoutMs for formatter budget` asserts a short injected timeout triggers formatter timeout while a sufficient budget succeeds; fails against the pre-fix code.
- [x] Mutation checkpoint: `v2/src/execution/completion-commit.test.ts` links `// @mutate` neutering the formatter invocation in the completion-commit path; inverting leaves an unformatted change committed and turns the `formats changed files before staging so committed tree passes biome check` regression red.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Commit phase — format-only on enumerated changed paths before `git add -A`, built-in scoped `bun biome check --write`, explicit separation from ready-gate `fixCommand` autofix; note ready-gate repair re-commits through the same committer so a second scoped format pass may occur after `fixCommand`.
- `v2/docs/operator-runbook.md` § Gate trust — implement runs scoped format-only Biome before staging so CI `check` formatting violations are unlikely without a manual fix; revise the cognitive-complexity bullet premise (implement now runs scoped format-only Biome, not full `fix` / semantic lint autofix) while preserving non-autofixable complexity recovery guidance (`fix` / `check:fix:unsafe` cannot repair it; `biome-ignore` or extract helpers).
- `v2/docs/v1-behaviors.md` — record v2 completion-commit format-only pass (scoped biome on changed paths, before staging; not `fixCommand`; distinct from ready-gate repair autofix).
