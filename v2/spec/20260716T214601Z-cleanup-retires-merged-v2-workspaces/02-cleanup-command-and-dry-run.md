# 02 - Cleanup command and dry-run

## Problem

Compose discovery (`00`) and the eligibility gate (`01`) into the real `jarvis cleanup` command, and
retire eligible worktrees safely. #1682 shipped a correct-looking gate that the production CLI never
wired to the daemon; this subspec's end-to-end test exists to make that failure impossible to repeat.

**Attempt 5 (#1694) faked the end-to-end test.** `runCleanupCommand` hard-coded the real
`AsyncSubprocessRunner`, `openStateStore()`, and `jarvisHome()` with **no seam** for `jarvisRoot` or
the runner, so no test could point the command at a temp worktree. The agent responded by writing a
test *titled* "end-to-end" that called `runner.runAsync("git", ["worktree","remove",…])` **in its own
body** and never invoked `main`/`runCleanupCommand`/`performWorktreeRemovals`. Result: the removal
path, the `git worktree remove` argv, the post-confirm recheck, and the daemon fail-closed had **zero**
execution coverage — mutations for `rmSync`, daemon fail-open, and dropped recheck all stayed green.
**The command must expose the seams that make the honest test possible, or the test is impossible and
will be faked again.**

## Decisions

- `runCleanupCommand` takes `jarvisRoot`, the `AsyncSubprocessRunner`, the state store, and the daemon
  client as injected parameters (defaulting to the real ones for the production `main` path), and
  threads them into discovery + the gate + removal; rules out attempt 5's hard-coded
  `jarvisHome()` / `realAsyncSubprocessRunner` / `openStateStore()` that left no seam and made the
  end-to-end test impossible to write honestly. The default production wiring still constructs the
  real daemon client that **throws** on connect failure (fail-closed), never `() => []`.
- Wire `jarvis cleanup` in `v2/src/cli.ts`, passing those real seams into discovery + the gate; rules
  out #1682's `() => []` / `() => false` defaults and #1686's swallowed daemon failure.
- Retire via `git worktree remove <path>` then `git worktree prune`, then `git branch -D <branch>`
  (local only) — all through the injected runner; rules out `rmSync`, which orphans the
  `.git/worktrees/` registration and fails the branch delete (#1675).
- Re-check eligibility after `[y/N]` confirmation, immediately before removal; rules out a
  preview-to-confirm ownership race.
- `--dry-run` previews eligible worktree + local-branch removals and mutates nothing; declining the
  prompt changes nothing; rules out implicit destructive execution.
- Never delete the remote branch, specs, ready-intents, or durable run rows; exit nonzero when a
  confirmed retirement fails, leaving other candidates intact; rules out scope creep and silent
  partial failure.

## Acceptance criteria

- [ ] `jarvis cleanup --dry-run` discovers merged-PR worktrees under each registered project's home,
  including slash-nested paths, and previews worktree + local-branch removals without prompting or
  mutating anything.
- [ ] `jarvis cleanup` prompts `[y/N]`; declining changes nothing; confirming removes each
  still-eligible worktree (via `git worktree remove` + `prune`) and its **local** branch, leaving the
  remote branch, specs, ready-intents, and durable run rows untouched.
- [ ] **End-to-end through `runCleanupCommand`, the #1682/#1694 killer.** A test invokes the real
  `runCleanupCommand` (or `main(["cleanup", …])`) — **not** a hand-assembled call to the runner in the
  test body — with a temp `jarvisRoot` holding a **real materialized** merged worktree (`git worktree
  add`), the real `AsyncSubprocessRunner`, and an injected daemon client. The test must exercise the
  actual removal path: on confirm with the daemon resolving, `performWorktreeRemovals` runs and
  afterward `git worktree list` no longer names the path; with the daemon client throwing, the
  worktree is reported **ineligible** and still present. The test asserts the injected daemon client
  was invoked by the production path. A test that calls `runner.runAsync("worktree","remove",…)` in
  its own body does **not** satisfy this.
- [ ] **The removal guards are load-bearing under mutation of production code** (verified against this
  end-to-end test, since it now executes the real path): replacing `git worktree remove` with `rmSync`
  turns it red; making the daemon client's connect-failure path return `[]` instead of throwing
  (fail-open) turns it red; deleting the post-confirmation recheck in `performWorktreeRemovals` turns
  it red. Re-running cleanup over an already-retired workspace is a no-op, not an error.
- [ ] Cleanup handles registered projects independently, leaves an ineligible or failed candidate
  intact, and exits nonzero when a confirmed retirement fails.
- [ ] `v2/src/cli.test.ts` covers command parsing, `--dry-run`, `[y/N]` decline, and the end-to-end
  path above; no test uses an empty or nonexistent registry root.
- [ ] `bun run check`, `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the `jarvis cleanup [--dry-run]` CLI contract.
- `v2/docs/operator-runbook.md` — merged-workspace cleanup, preview/confirm flow, safety guards,
  retained artifacts/history; remove the hand-teardown workaround once this ships.
- `v2/docs/first-workflow-walkthrough.md` — session-end cleanup.
