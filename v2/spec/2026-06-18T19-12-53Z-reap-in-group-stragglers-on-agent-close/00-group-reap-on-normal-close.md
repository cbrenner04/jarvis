# Group-reap on normal agent close

## Problem

`runAgent` (`v1/src/agents/spawn.ts`) spawns each agent `detached: true` in its
own process group but only group-kills (`process.kill(-pgid, …)`) on the
abort/timeout path. On a normal child `close`, no group sweep runs, so an
in-group descendant the agent left running survives the iteration.

## Behavior

On the success branch only — the branch reached when there is no abort reason
and the child closed with `code === 0 || code === undefined` (spawn.ts:79–80) —
best-effort `process.kill(-pgid, "SIGKILL")` so in-group stragglers die with the
agent. The reap does **not** run on the error-settle path (spawn.ts:91), the
quota/model-config branches, or the `child.on("error")` path (spawn.ts:111).
Reaping is non-fatal: it is wrapped so any `process.kill` error is swallowed and
the settled result kind and exit code are unchanged. Killing an already-empty
group yields `ESRCH`; on a clean close where the agent left no descendant this
is the normal no-op outcome, not a failure.

In-group only: a descendant that left the agent's process group (e.g. started
its own session) is out of scope — `-pgid` does not reach it, and the spec does
not attempt to.

## Decisions

- Sweep on the success `close` branch only; abort/timeout already group-kill, so
  reaping there would double-kill — alternative ruled out: sweeping
  unconditionally.
- Best-effort, wrapped so a kill error never throws out of settlement —
  alternative ruled out: letting a failed reap surface as the run result.
- Go straight to `SIGKILL` with no SIGTERM→grace escalation (unlike the abort
  path) — alternative ruled out: mirroring abort's SIGTERM→grace→SIGKILL. The
  child already exited normally, so there is nothing to terminate gracefully and
  a grace timer would only delay the iteration.

## Tasks

- Add the best-effort reap to the success branch (spawn.ts:79–80): on
  `code === 0 || code === undefined` with no abort reason, run
  `process.kill(-pgid, "SIGKILL")` inside a try wrapper that swallows the error,
  then settle `ok` as before. Do not touch the error, quota, model-config, or
  `child.on("error")` paths.
- Add a spawn test demonstrating the close-path reap reaches a surviving
  group member: a fake agent spawns a detached background descendant in the same
  process group, records its PID, then exits 0. Assert the descendant is dead
  after `runAgent` resolves `kind: "ok"`, via a bounded poll on PID liveness
  (the descendant is SIGKILLed asynchronously during settlement, so a single
  synchronous check would flake). This test is what demonstrates the relied-on
  POSIX guarantee that `process.kill(-pgid)` reaches a group whose leader has
  already exited.
- Add a spawn test that a forced reap failure on the close path leaves the
  settled result kind (`ok`) and exit code unchanged. Mechanism: stub
  `process.kill` for the duration of the test so the close-path call throws,
  then restore it — no new public or option surface. (If the implementer finds
  the stub infeasible, record the chosen mechanism as
  `Deferred to first consumer:` rather than widening the options type.)
- Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md` per Documentation
  updates.

## Acceptance criteria

- [ ] A success-branch agent completion (close `code === 0` or
  `code === undefined`, no abort) that left an in-group descendant running reaps
  that descendant.
- [ ] A kill failure during the close-path sweep leaves the settled result kind
  (`ok`) and exit code unchanged.
- [ ] A descendant that left the agent's process group is not targeted (out of
  scope).
- [ ] Existing spawn, abort, and timeout behavior is unchanged.
- [ ] `v1/docs/run-loop.md` states the harness reaps in-group stragglers on
  normal agent completion.
- [ ] `v2/docs/v1-behaviors.md` records the close-path group reap as current v1
  behavior.

## Documentation updates

- `v1/docs/run-loop.md`: harness best-effort reaps in-group stragglers via
  `process.kill(-pgid, SIGKILL)` on normal agent completion; the reap is
  non-fatal.
- `v2/docs/v1-behaviors.md`: add the close-path group reap under abort/process
  lifecycle (beside the abort and timeout entries), sourced to
  `v1/src/agents/spawn.ts`. State that normal completion is SIGKILL-only with no
  SIGTERM grace — the contrast with the abort/timeout SIGTERM→grace→SIGKILL
  paths is the fact a v2 reader needs to reconcile the three. Note the reap is
  POSIX-only (it relies on `-pgid`) and a kill failure is non-fatal.
