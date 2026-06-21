# Operator Runbook

Reference for recurring session friction: patterns, workflows, and recovery paths when automated gates fail or need human intervention.

## Background-run-and-poll pattern

When spawning a long-running jarvis invocation that might outlast the current shell session, use a tracked runner:

```sh
nohup jarvis1 run <spec> >run.log 2>&1 &
screen -d -m jarvis1 run <spec>
tmux new-session -d -s jarvis1 "jarvis1 run <spec>"
```

Then poll: `tail -f run.log`, or check `git log --oneline -n 10` for branch changes.

Avoid bare shell `&` (process dies when shell exits). Tracked runners (`nohup`, `screen`, `tmux`, or systemd timer) survive shell exit and leave a durable log.

## Integration-merge-then-retest pattern

When merging a draft PR for integration testing:

1. **Run the completion gate locally first.** Use `bun run ready` on the unmerged branch to verify all checks pass.
2. **Merge the branch.** Once `ready` succeeds, use `gh pr merge --merge` to merge locally.
3. **Re-run tests locally** on the merged branch to catch any integration-only issues before pushing.
4. **Push once verified.** Push the merged commit once local verification completes.

Rationale: merging first and fixing issues afterward risks red commits. Running `ready` before merge prevents most lint/test issues; re-running `test` after merge catches integration-only flakes.

## Manual-finalize recovery (last-resort path)

When automated gates (completion gate, lint convergence, flaky-test retry, or parallel-load flake recovery) fail or are unsafe to re-run, use manual finalization:

```sh
# Inspect the worktree state
git status
git diff

# Manually fix issues (e.g., lint, type errors, test flakes)
# Then run the completion gate explicitly
bun run ready

# Only then commit and merge
git add -A  # caution: this absorbs any manual commits; Jarvis owns commits on this worktree
git commit -m "<message>"

# Tick any satisfied acceptance criteria in the spec,
# mark the PR as ready, and merge with admin privileges
gh pr ready
gh pr merge --admin
```

This is a fallback for:
- **Completion gate**: the harness's check that all acceptance criteria are ticked before deeming the spec complete. Admin-merge skips approval but does not skip local lint/test verification — the operator must run `bun run ready` or `bun run check` before merging.
- **Lint convergence**: the full tier's `check` command (Biome lint) that must pass after `check:fix:unsafe` runs.
- **Flaky-test retry**: `scripts/ready.ts` automatically runs parallel tests, then serially if parallel fails; if both fail, the run exits with non-zero.
- **Parallel-load flake recovery**: when tests pass serially but failed in parallel (load-dependent issue), `ready` detects and reports this; manual re-runs of `bun test` with different parallelism can confirm the flake.

## Sandbox blindness and false-negatives

The sandbox (in Claude Code) may hide real process state in several ways:

### `ps` and `pgrep` blindness

`ps` and `pgrep` can only see processes in the current execution context; background processes spawned outside the sandbox are invisible. A background agent (`nohup jarvis1 run ...`) won't show up in `pgrep` queries inside. When matching process names, use stable substrings that won't collide with unrelated processes:

```sh
pgrep -f 'jarvis1 run'        # Good: specific command token
pgrep -f 'run'                # Risky: too generic, matches other things
```

Rationale: the stable command-token match (`jarvis1 run`) is the distinguishing substring. Relative-path or full-path matching is fragile; a stable token in the command line is what matters.

**Workaround**: poll the log file (`tail -f run.log`) or check git history (`git log --oneline -n 10`) instead of process queries.

### Localhost/auth blindness

Network requests to `localhost` and POSIX auth operations (reading `~/.netrc`, SSH keys, or system keychain) may fail or not behave as expected inside the sandbox. These are *false negatives* — the operations work fine when run unsandboxed.

- An apparent auth failure (`gh` command fails with a permission error, `localhost` requests time out) is likely a sandbox limitation, not a real problem.
- **Workaround**: re-run the same `jarvis`, `git`, `gh`, or `localhost` command *outside the sandbox* and do not debug the apparent auth/connection failure before re-checking unsandboxed. If the command succeeds outside the sandbox, the sandbox was the issue.

## Branch-protection and admin-merge workflow

This repo enforces branch protection: `main` requires at least one approval and a passing CI check.

### Can't self-approve

- Draft PRs are opened as *draft* so they don't count toward the approval requirement.
- A single-operator workflow still needs a self-approval workaround because `main` branch protection blocks self-approval.
- The workaround is to bump the PR out of draft status, let CI run and pass, then **use admin merge** (Jarvis-owned step, not manual).

### Admin-merge path

- Jarvis flips the draft PR to `ready` once the spec completes (all acceptance criteria ticked).
- Admin merge (`gh pr merge --admin`) skips the approval requirement and merges directly *without running any local gates*.
- The operator must run `bun run ready` (or at minimum `bun run check`) **before** the merge to verify all checks pass; admin-merge does not re-verify them.

Workflow:
1. Spec is complete (all acceptance criteria ticked).
2. Operator runs `bun run ready` locally to verify the spec passes all lint, type, and test gates.
3. Jarvis automatically flips PR to `ready` and merges with admin privileges.
4. The merge succeeds without additional gate checks; the pre-merge `ready` run is the verification step.

## `check:fix` vs `check:fix:unsafe` distinction

These are Biome commands with different rule coverage and mutability:

- **`check:fix`** (`bun run check:fix`): Biome's standard checks + fixes; doesn't apply unsafe rules. Safe to run in automation. Leaves residual issues that require `--unsafe` or hand edits: unused-var, noExplicitAny, non-null assertions.
- **`check:fix:unsafe`** (`bun run check:fix:unsafe`): Biome's standard checks + fixes *plus* unsafe rule fixes (often riskier transformations). Used only in the `full` ready tier, before re-linting with `check`.

The full ready tier (run before any merge) applies `check:fix:unsafe` first, then runs the full lint gate (`check`), ensuring that even aggressive fixes pass final review.

Note: `noImplicitAny` is a TypeScript compiler flag (in `tsconfig.json`), not a Biome fix target; lint and type-checking are separate gates. Typecheck is its own `bun run typecheck` step.

## Branch-before-edit discipline

Always create a new git worktree or branch *before* making edits to code or specs:

1. **For active work**: specs already on disk are run through `jarvis` via worktrees (one worktree per active spec; names are UTC timestamps for uniqueness).
2. **For new specs**: draft first in plan mode (which creates its own worktree), merge to `main`, then start a separate patch-mode run on a new worktree.
3. **Never edit specs or code on `main` directly.** All work happens on a branch or worktree; `main` is a stable merge target.

Rationale: worktrees allow parallel spec drafting and testing without blocking each other. Editing `main` directly creates ambiguity about whether changes are integrated or in-progress.

