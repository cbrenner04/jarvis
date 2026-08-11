---
name: subprocess-process-group-kill
---

# Kill the whole process group in the shared async subprocess runner

## Prerequisites

## Behavior

`shared/subprocess.ts` gains an opt-in per-call option that spawns the child in its own process group and, on abort or timeout, signals the entire group (SIGTERM, then SIGKILL after the existing grace period) instead of only the direct child. Today `runAsync` calls `child.kill()`, which leaves grandchildren — `bun test` pool workers — running after the parent dies.

The runner exposes the spawned group id to the caller so an owner can record it durably and reap it later; the group id is observable for a call that opted in and absent for one that did not.

Default behavior for existing callers is unchanged: without the option, spawn and kill semantics stay exactly as today — this is a shared primitive consumed by v1 and v2, so no caller may be silently switched to group semantics here.

Deferred to first consumer: the option name and the exact shape by which the group id is surfaced — pin when the ready-gate caller lands.

## Acceptance criteria

- [ ] A group-mode `runAsync` call spawns detached; a test asserts the recorded group id and that aborting the call signals the group, not just the direct child.
- [ ] A grandchild of a group-mode call is dead after abort; a test spawns a child that spawns its own long-lived child, aborts, and asserts the grandchild is gone.
- [ ] A call without the option keeps today's spawn options and single-child kill path, pinned by a test.
- [ ] `bun run typecheck` and the test scripts matching the touched surfaces pass.

## Documentation updates

- Document group mode and group-id exposure wherever `shared/subprocess.ts` behavior is described in `v2/docs/`, per `v2/docs/documentation-standard.md`.
