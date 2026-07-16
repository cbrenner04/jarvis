# Accumulated worktrees silently break every agent's sandbox (E2BIG)

Each registered git worktree becomes a sandbox deny-path. Past ~200 of them, the exec
argument list exceeds the OS limit and **every** command inside an agent session fails
with `E2BIG` — including a bare `pwd`. The agent cannot typecheck, cannot test, cannot
verify anything, and blocks. Nothing warns beforehand.

## Problem

Observed 2026-07-13. Two consecutive claude patch runs blocked with:

```
every Bash invocation in this session — including a bare `true` — fails with E2BIG
(command line plus environment exceed the OS exec argument limit); the sandbox profile
carries ~226 deny paths, ~198 of them from stale registered git worktrees
```

Both agents had **finished the implementation**. They could not run `bun run typecheck`
or any test, so they left acceptance criteria unchecked and blocked — correctly, but for
a reason entirely outside the spec.

The repo had **67 registered worktrees** at the time (41 in `.worktree/`, 25 under
`~/.jarvis/worktrees/`), accumulated across a single long session. 54 belonged to
already-merged PRs. Hand-pruning to 13 cleared it.

The failure mode is nasty because:

- It is **silent until total**. There is no degradation — commands work, then no command
  works at all.
- It looks like an agent problem. Two different runs "blocked" and a naive read is that
  the agent gave up.
- It hits the *verification* step specifically, so work gets done and then thrown away
  unverified.
- `dangerouslyDisableSandbox` was also rejected, so there was no escape hatch.

## Scope

- Bound the number of worktrees the harness leaves registered, or stop the count from
  reaching the exec limit (dedupe/collapse deny paths, use a prefix, or scope the sandbox
  profile to the active worktree rather than every registered one).
- Warn the operator well before the cliff — a run that is about to spawn an agent into a
  sandbox that cannot exec anything should say so, not discover it agent-side.
- Retire merged worktrees automatically. `jarvis1 cleanup` does this, but only when the
  operator remembers to run it; the accumulation happens during the session, not between
  sessions.

## Decisions

- The deny-path list scaling with *historical* worktrees is the bug. An agent working in
  one worktree does not need 200 deny entries for worktrees that no longer matter.
- Auto-prune on run start is tempting but must not remove a worktree another live run
  owns — the same hazard `concurrent-session-scope-cleanup` covers.

## Out of scope

- `v2-cleanup-command` (v2 has no cleanup at all — separate seed, and its absence is what
  let the `~/.jarvis/worktrees/` half accumulate here).

## Documentation updates

- `v1/docs/operator-runbook.md` — until this ships: **run `jarvis1 cleanup` mid-session**,
  not just at close-out, and treat an agent blocking on `E2BIG` as a worktree-count
  problem rather than an agent failure. Remove the caveat when this lands.
