# Tag agent spawns with a run+iteration marker and reap survivors

## Problem

Agent tools can place a descendant in a new session/process group (e.g. a
`bun run test` → `bun test` subtree). When the watchdog kills `-pgid`, that
descendant re-parents to init (PPID=1) and escapes the group kill, then pegs
CPU for minutes after its agent is gone. These orphans accumulate across
iterations. `-pgid` alone cannot reach them because they are no longer in the
group.

## Decisions

Decision: inject a unique inheritable env var (`JARVIS_RUN_ID`) at the spawn-env assembly point in `runAgent`, valued per invocation as run-id + iteration. — rules out tagging in a per-agent-class `config.env`, which cannot vary per iteration.
Decision: the run-id is generated once per `runCommand` and the marker value embeds run-id and iteration so reaping a later iteration cannot kill an earlier iteration's still-settling tree. — rules out a process-wide constant that conflates iterations.
Decision: reap by scanning live processes for the marker env value and SIGKILLing matches, not by `-pgid`. — rules out a group sweep, which by definition misses re-parented orphans.
Decision: reap at patch iteration end on both the settle path and the abort/timeout path, and again at run finalize. — rules out reaping only on timeout, which would leak orphans from normal-settle iterations.
Decision: reaping is best-effort and never alters run exit codes or stop reasons; failures are swallowed (optionally logged). — rules out treating a reap failure as a run error.
Decision: process discovery uses an OS process listing (e.g. `ps -e`/`/proc`) filtered to the marker; the harness only kills processes carrying its own run-id marker. — rules out killing by name/CPU heuristics, which could hit unrelated processes.

Deferred to first consumer: whether plan/review/prompt/shrink spawns also reap — pin when a caller needs it. This subspec scopes reaping to the patch iteration loop and finalize per the intent; the marker is inherited by every spawn but only the patch loop reaps.

## Tasks

- Generate a run-scoped id once per `runCommand` and pass an iteration-scoped marker value into each agent invocation.
- In `runAgent`, set the marker env var on the assembled spawn env so all descendants inherit it.
- Add a best-effort reap helper that finds live processes carrying a given marker value and SIGKILLs them; never throws.
- Call the reap helper at patch iteration end (settle and abort/timeout) and at run finalize.
- Add a test proving a descendant that calls `setsid`/escapes the group (PPID=1, own session) and carries the marker is killed at iteration end / finalize.
- Add a test proving an induced reap failure leaves the run exit code unchanged.
- Update docs listed below.

## Acceptance criteria

- [ ] Every agent invocation runs with an inheritable environment marker whose value is unique to the run and iteration that spawned it.
- [ ] A descendant that re-parents to init (PPID=1, own session) and carries the iteration marker is SIGKILLed by the harness at iteration end and/or finalize, rather than left running.
- [ ] Marker-based reaping runs on both the normal settle path and the abort/timeout path of a patch iteration, and at run finalize.
- [ ] A reaping failure (process listing or kill error) does not change the run's exit code or stop reason.
- [ ] The harness only kills processes carrying its own run's marker; processes without the marker are never targeted by reaping.
- [ ] Existing watchdog, iteration-timeout, run-timeout, and finalize behavior is unchanged: the watchdog still logs `[watchdog] iteration timeout fired after Nms; killing agent pgid <pgid>`, group SIGTERM→SIGKILL escalation still occurs, and timeout/finalize exit codes are unchanged.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: state that the harness reaps agent descendants (including re-parented orphans that escaped the process group) via an inherited per-iteration env marker on every patch iteration end (settle and abort/timeout) and at finalize, best-effort and non-fatal.
- `v1/docs/agents.md`: note the inheritable env marker (`JARVIS_RUN_ID`) tagging every agent invocation and its orphan-reaping purpose, in the abort/process-lifecycle context.
- `v2/docs/v1-behaviors.md`: under "Abort and process lifecycle", record marker-based orphan reaping as current v1 behavior (inherited marker, reap at patch iteration end and finalize, best-effort, exit codes unchanged).
