---
name: reap-in-group-stragglers-on-agent-close
---

# Reap in-group stragglers when an agent child closes normally

**Scope.** `v1/src/agents/spawn.ts`, its tests, docs.

## Problem

`runAgent` spawns each agent `detached: true` in its own process group, but
group-kills (`process.kill(-pgid, …)`) only on the abort/timeout path. On a
normal child `close`, no group sweep runs, so any in-group descendant the agent
left running survives the iteration.

## Desired behavior

When an agent child closes without abort/timeout, the harness best-effort
`process.kill(-pgid, SIGKILL)` so in-group stragglers die with the agent.
Reaping is non-fatal: a kill failure does not change the settled result kind or
exit code.

## Decisions

- Sweep on the normal `close` path only; abort/timeout already group-kill.
- Best-effort, wrapped so ENOENT/EPERM/ESRCH never throw out of settlement.

## Acceptance signals

- Normal (non-abort) agent completion that left an in-group descendant running
  reaps that descendant.
- A kill failure during the close-path sweep leaves the settled result kind and
  exit code unchanged.
- Existing spawn/abort/timeout tests still pass.

## Documentation updates

- `v1/docs/run-loop.md`: harness reaps in-group stragglers on normal agent
  completion.
- `v2/docs/v1-behaviors.md`: record close-path group reap as current v1
  behavior.

## Prerequisites
