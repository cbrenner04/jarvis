---
name: reap-reparented-agent-orphans-via-marker
---

# Reap re-parented agent orphans via inherited env marker

**Scope.** `v1/src/agents/spawn.ts`, `v1/src/modes/patch/run.ts`, tests, docs.

## Problem

Agent tools can place a descendant in a new session/group; when the watchdog
kills `-pgid`, that descendant re-parents to init (PPID=1) and escapes the
group kill. Observed: a `bun run test` → `bun test` subtree at PPID=1 pegging
~99% CPU for 13+ minutes after its agent was gone. These orphans accumulate
across iterations and bog the machine down. `-pgid` alone cannot reach them.

## Desired behavior

No agent-spawned process — including one re-parented to init that escaped its
process group — outlives the iteration that spawned it. On every patch
iteration end (normal settle and abort/timeout) and at run finalize, the
harness finds live processes carrying that iteration's marker and SIGKILLs
them.

## Decisions

- Tag each agent spawn with a unique inheritable env marker (e.g.
  `JARVIS_RUN_ID` + iteration) where the spawn env is assembled; descendants
  inherit it.
- Reap by marker, not `-pgid` — orphans escape the group, so a group sweep
  cannot find them.
- Reap at patch iteration end (both settle and abort/timeout) and at finalize.
- Best-effort and non-fatal: reaping failures must not change run exit codes.

## Acceptance signals

- A descendant that re-parents to init (PPID=1, own session) and carries the
  iteration marker is killed at iteration end / finalize, not left running.
- Reaping failures leave run exit codes unchanged.
- Existing watchdog/timeout/finalize tests still pass; exit codes unchanged.

## Documentation updates

- `v1/docs/run-loop.md`: harness reaps agent descendants (incl. re-parented
  orphans) on every iteration end and at finalize.
- `v1/docs/agents.md`: note the env marker tagging agent invocations and its
  reaping purpose.
- `v2/docs/v1-behaviors.md`: record marker-based orphan reaping as current v1
  behavior.

## Prerequisites
