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

1. **Merge without auto-pushing.** Use `gh pr merge --merge --skip-ci` to merge locally without triggering CI.
2. **Re-run `bun run ready` locally** on the merged branch to catch lint/test issues before pushing.
3. **Push only if ready-gate passes.** Push the merged commit once local `ready` succeeds.

Rationale: draft PRs often have lint or flaky tests that don't surface until the full `ready` gate runs (which includes `check:fix:unsafe` and re-linting). Testing locally first avoids red commits.

## Manual-finalize recovery (last-resort path)

When automated gates (completion gate, lint convergence, flaky-test retry, or parallel-load flake recovery) fail or are unsafe to re-run, use manual finalization:

```sh
# Inspect the worktree state
git status
git diff

# Manually fix issues (e.g., lint, type errors, test flakes)
# Then run the final lint check explicitly
bun run check

# Verify tests still pass
bun run test

# Only then commit and merge
git add -A
git commit -m "<message>"
```

This is a fallback for:
- **Completion gate**: the harness's check that all acceptance criteria are ticked before deeming the spec complete.
- **Lint convergence**: the full tier's `check` command (Biome lint) that must pass after `check:fix:unsafe` runs.
- **Flaky-test retry**: `scripts/ready.ts` automatically runs parallel tests, then serially if parallel fails; if both fail, the run exits with non-zero.
- **Parallel-load flake recovery**: when tests pass serially but failed in parallel (load-dependent issue), `ready` detects and reports this; manual re-runs of `bun test` with different parallelism can confirm the flake.

## Sandbox blindness and false-negatives

The sandbox (in Claude Code) may hide real process state in several ways:

### `ps` and `pgrep` blindness

`ps` and `pgrep` can only see processes in the current execution context; background processes spawned outside the sandbox are invisible. A background agent (`nohup jarvis1 run ...`) won't show up in `pgrep` queries inside. When matching process names, use stable substrings that won't collide with unrelated processes:

```sh
pgrep -f 'jarvis1 run'        # Good: specific command token
pgrep -f '/Users/.*/bin/jarvis1'  # Better: full path if spawned that way
pgrep -f 'run'                # Risky: too generic, matches other things
```

Rationale: process argument strings can be rewritten by init systems. A substring like `jarvis1 run` is stable across launchers; generic tokens like `run` alone can match unrelated processes.

**Workaround**: poll the log file (`tail -f run.log`) or check git history (`git log --oneline -n 10`) instead of process queries.

### Localhost/auth blindness

Network requests to `localhost` and POSIX auth operations (reading `~/.netrc`, SSH keys, or system keychain) may fail or not behave as expected inside the sandbox.

- A background agent that needs to authenticate (e.g., against GitHub or a private registry) may hang or fail silently.
- **Workaround**: for long background runs, ensure auth is set up *outside* the sandbox first (e.g., `gh auth status`), and test network operations in a non-sandbox shell.

## Branch-protection and admin-merge workflow

This repo enforces branch protection: `main` requires at least one approval and a passing CI check.

### Can't self-approve

- Draft PRs are opened as *draft* so they don't count toward the approval requirement.
- A single-operator workflow still needs a self-approval workaround because `main` branch protection blocks self-approval.
- The workaround is to bump the PR out of draft status, let CI run and pass, then **use admin merge** (Jarvis-owned step, not manual).

### Admin-merge path

- Jarvis flips the draft PR to `ready` once the spec completes (all acceptance criteria ticked).
- Admin merge (`gh pr merge --admin`) skips the approval requirement and merges directly.
- Admin merge runs `bun run ready` as part of the merge process (completion gate), so the PR is re-verified at merge time.

Workflow:
1. Spec is complete (all acceptance criteria ticked).
2. Jarvis automatically flips PR to `ready` and merges with admin privileges.
3. The merge itself triggers `ready` (completion gate), confirming no regressions since the last local `ready`.

## `check:fix` vs `check:fix:unsafe` distinction

These are Biome commands with different rule coverage and mutability:

- **`check:fix`** (`bun run check:fix`): Biome's standard checks + fixes; doesn't apply unsafe rules. Safe to run in automation.
- **`check:fix:unsafe`** (`bun run check:fix:unsafe`): Biome's standard checks + fixes *plus* unsafe rule fixes (often riskier transformations). Used only in the `full` ready tier, before re-linting with `check`.

The full ready tier (run at admin-merge time) applies `check:fix:unsafe` first, then runs the full lint gate (`check`), ensuring that even aggressive fixes pass final review.

Note: `noImplicitAny` is a TypeScript compiler flag (in `tsconfig.json`), not a Biome fix target; lint and type-checking are separate gates. Typecheck is its own `bun run typecheck` step.

## Branch-before-edit discipline

Always create a new git worktree or branch *before* making edits to code or specs:

1. **For active work**: specs already on disk are run through `jarvis` via worktrees (one worktree per active spec; names are UTC timestamps for uniqueness).
2. **For new specs**: draft first in plan mode (which creates its own worktree), merge to `main`, then start a separate patch-mode run on a new worktree.
3. **Never edit specs or code on `main` directly.** All work happens on a branch or worktree; `main` is a stable merge target.

Rationale: worktrees allow parallel spec drafting and testing without blocking each other. Editing `main` directly creates ambiguity about whether changes are integrated or in-progress.

