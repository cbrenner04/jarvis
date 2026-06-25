---
name: agent-cannot-install-deps-in-symlinked-worktree
---

# Dep-adding specs fail: agents can't `bun install` in a symlinked-node_modules worktree

## Problem

Any spec that adds an npm dependency cannot be implemented unattended. Jarvis
worktrees symlink `node_modules` to the primary checkout (`worktreeSymlinks:
["node_modules"]`), which sits **outside** the worktree, and the agent sandbox
forbids writes there. Both actuators fail, differently, so it reads like two
unrelated flukes:

- **codex** (`--sandbox workspace-write`): network is blocked, so `bun add`
  fails on package-manifest fetch (`FailedToOpenSocket`), and it can't use the
  global Bun cache (it redirects to an empty workspace-local cache).
- **claude**: `bun install` hits `EPERM` writing through the `node_modules`
  symlink to the primary checkout, which is outside the agent's writable
  worktree root.

Observed this session on `markdown-lint-script`: blocked four times across both
agents. Only landed after the operator hand-installed the dependency
out-of-sandbox and synced the primary `node_modules` — exactly the manual step
the north star wants eliminated.

## Direction

Let dependency-adding specs run unattended. Options for plan to weigh:

- **Harness-side install:** detect a `package.json` / lockfile change after an
  iteration and have Jarvis run `bun install` itself (outside the agent
  sandbox, where network + writes work) instead of asking the agent to.
- **Real per-worktree `node_modules`:** for worktrees whose spec touches
  dependencies, give a real (copied or freshly-installed) `node_modules` the
  agent can write, instead of the symlink.
- **Per-run symlink opt-out:** a flag/heuristic that skips the `node_modules`
  symlink when the spec is known to add deps.

## Out of scope

- Changing the default symlink optimization for specs that do not touch
  dependencies (it is what makes worktrees cheap).

## References

- `worktreeSymlinks` in `~/.jarvis/config.json` and the worktree setup code.
- `v1/src/agents/codex.ts` — `--sandbox workspace-write` (network-blocked).
- Observed 2026-06-24 on `markdown-lint-script`
  (`reports/2026-06-24T...-overlord.md`).
