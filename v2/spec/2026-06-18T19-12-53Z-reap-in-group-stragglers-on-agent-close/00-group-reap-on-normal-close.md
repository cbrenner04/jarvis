# Group-reap on normal agent close

## Problem

`runAgent` (`v1/src/agents/spawn.ts`) spawns each agent `detached: true` in its
own process group but only group-kills (`process.kill(-pgid, …)`) on the
abort/timeout path. On a normal child `close`, no group sweep runs, so an
in-group descendant the agent left running survives the iteration.

## Behavior

On the normal `close` path (not abort, not timeout), best-effort
`process.kill(-pgid, "SIGKILL")` so in-group stragglers die with the agent.
Reaping is non-fatal: a kill failure (ENOENT/EPERM/ESRCH) does not change the
settled result kind or exit code.

## Decisions

- Sweep on the normal `close` path only; abort/timeout already group-kill, so
  reaping there would double-kill — alternative ruled out: sweeping
  unconditionally.
- Best-effort, wrapped so a kill error never throws out of settlement —
  alternative ruled out: letting a failed reap surface as the run result.

## Tasks

- Add a best-effort `process.kill(-pgid, "SIGKILL")` reap on the non-abort
  `close` path, before/around final settlement, swallowing errors.
- Add a spawn test: a fake agent spawns a background descendant, records its
  PID, then exits 0; assert the descendant is dead after `runAgent` resolves
  `kind: "ok"`.
- Add a spawn test: a forced kill failure on the close path leaves the settled
  result kind and exit code unchanged.
- Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md` per Documentation
  updates.

## Acceptance criteria

- [ ] A normal (non-abort, non-timeout) agent completion that left an in-group
  descendant running reaps that descendant.
- [ ] A kill failure during the close-path sweep leaves the settled result kind
  (`ok`) and exit code unchanged.
- [ ] Existing spawn, abort, and timeout behavior is unchanged.
- [ ] `v1/docs/run-loop.md` states the harness reaps in-group stragglers on
  normal agent completion.
- [ ] `v2/docs/v1-behaviors.md` records the close-path group reap as current v1
  behavior.

## Documentation updates

- `v1/docs/run-loop.md`: harness best-effort reaps in-group stragglers via
  `process.kill(-pgid, SIGKILL)` on normal agent completion; the reap is
  non-fatal.
- `v2/docs/v1-behaviors.md`: add the close-path group reap (normal completion
  group-kills in-group descendants, kill failure non-fatal) under abort/process
  lifecycle, sourced to `v1/src/agents/spawn.ts`.
