---
name: terminal-settle-cancels-repair-agent-and-releases-lock
---

# Terminal settle cancels the repair agent and releases the worktree lock

## Problem

After an implement run settled `completed`, a `codex` child of the owning daemon kept running in the worktree and held the lock, blocking `jarvis run workflow implement` on the same `(project, branch)`.

## Decisions

- Settlement cancels the outstanding repair agent invocation — rules out letting repair outlive the durable row because work might still land.
- Repair cancellation runs on every terminal settle path (`completed`, `failed`, `killed`), including `killed` mid-repair — rules out orphan repair after kill.
- The worktree lock is released when the owning run settles on every terminal path (`completed`, `failed`, `killed`) — rules out freeing the lock only on daemon exit or only on success.

## Acceptance criteria

- [ ] The repair agent invocation is cancelled at settlement on every terminal path (`completed`, `failed`, `killed`, including `killed` mid-repair); a test asserts no agent process (or invocation promise) remains outstanding once the row is terminal, and fails if cancellation is removed.
- [ ] The worktree lock is released on every settle path (`completed`, `failed`, `killed`); a test asserts a subsequent `jarvis run workflow implement` on the same `(project, branch)` is not refused with `holds worktree lock`.
- [ ] Inverting lock release on terminal settle turns the lock-release acceptance test RED.

## Documentation updates

- `v2/docs/write-behavior.md` — agent cancellation at terminal settle.
- `v2/docs/daemon-host.md` — lock release on every terminal settle.
- `v2/docs/v1-behaviors.md` — cancel-at-settle and lock release on terminal settle.

## Prerequisites
