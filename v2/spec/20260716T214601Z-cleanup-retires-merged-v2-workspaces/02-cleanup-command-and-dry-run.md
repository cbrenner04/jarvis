# 02 - Cleanup command and dry-run

## Problem

Compose discovery (`00`) and the eligibility gate (`01`) into the real `jarvis cleanup` command, and
retire eligible worktrees safely. #1682 shipped a correct-looking gate that the production CLI never
wired to the daemon; this subspec's end-to-end test exists to make that failure impossible to repeat.

## Decisions

- Wire `jarvis cleanup` in `v2/src/cli.ts`, constructing the **real** `AsyncSubprocessRunner`, daemon
  client, and durable run store and passing them into discovery + the gate; rules out #1682's
  `() => []` / `() => false` defaults and #1686's swallowed daemon failure.
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
- [ ] **End-to-end through the real CLI (`v2/src/cli.ts`), the #1682 killer.** A test drives the real
  `cleanup` entry with only the permitted seams injected, against a temp `jarvisRoot` with a
  materialized merged worktree. With the daemon client resolving (no live run) the worktree is listed
  and, on confirm, removed; with the daemon client throwing it is reported **ineligible** and left
  intact. The test asserts the daemon client was actually invoked by the production path.
- [ ] The removal argv is asserted (`git worktree remove <path>`, then `git worktree prune`, then
  `git branch -D <branch>`); replacing `git worktree remove` with `rmSync` turns a test red. After a
  real retirement in a temp worktree, `git worktree list` no longer names the path and re-running
  cleanup over it is a no-op, not an error.
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
