# Tag agent spawns with a run+iteration marker and reap survivors

## Problem

Agent tools can place a descendant in a new session/process group (e.g. a
`bun run test` → `bun test` subtree). When the watchdog kills `-pgid`, that
descendant re-parents to init (PPID=1) and escapes the group kill, then pegs
CPU for minutes after its agent is gone. These orphans accumulate across
iterations. `-pgid` alone cannot reach them because they are no longer in the
group. The only handle that survives re-parenting is an inherited env marker,
and on the target OS (darwin) finding it needs a full env-bearing process
listing — `/proc` is absent and per-PID `ps eww <pid>` does not print child env.

## Decisions

Decision: inject a unique inheritable env var (`JARVIS_RUN_ID`) at the spawn-env assembly point in `runAgent`, valued per invocation. — rules out tagging in a per-agent-class `config.env`, which cannot vary per spawn.
Decision: the run-id is generated once per `runCommand`; the marker value is `<run-id>:<iteration>:<spawn-seq>`, unique per `runAgent` call. — rules out a process-wide constant that conflates iterations and a per-iteration value that an in-iteration PR-body spawn would share with the foreground agent.
Decision: the marker value carries to `runAgent` as a new field on `AgentRunOptions` (mirroring the existing per-invocation options like `signal`/`abortKillGraceMs`), not via `config.env`. — rules out inventing a side channel; `config.env` is per-agent-class and static.
Decision: discover processes with `ps -A -o pid= -o command= eww` and match the marker as a whole `KEY=VALUE` token in the env-bearing listing; SIGKILL the matched pids. — rules out `/proc` (absent on darwin) and per-PID `ps eww <pid>` (does not print child env on darwin); only a full BSD env listing exposes the inherited marker.
Decision: match requires the exact `JARVIS_RUN_ID=<value>` token (value shaped with non-numeric separators) so iteration `1` cannot match `10` and the marker cannot match as a substring of an unrelated variable. — rules out a loose substring scan that mis-kills.
Decision: reap only processes carrying this run's own marker value; never the harness's own pid and never a value from another run. — rules out a kill-by-match that could hit the harness or a concurrent run sharing the env var name.
Decision: reaping never reads, logs, or stores any scanned environment blob or matched env line; the only diagnostics emitted are the count of killed pids and this run's own marker value. — rules out logging other processes' full environments (tokens/keys), a security leak the BSD env listing would otherwise expose.
Decision: reaping is best-effort and never alters run exit codes or stop reasons; listing/kill errors are swallowed. — rules out treating a reap failure as a run error.
Decision: hook reaping in `runIteration`'s single per-iteration `finally` (covering all ~18 return/exit sites, settle and abort/timeout alike) and in `runCommand`'s finalize `finally` (covering the SIGINT and `{ kind: "exit" }` `process.exit` paths). — rules out bolting reaping onto only the timeout branch, which leaks orphans from quota/no-progress/blocker/exit/normal-settle exits.
Decision: the reap entry point is overridable for tests (paralleling `__testKillGraceMs`) so an induced failure is injectable deterministically at run level. — rules out a unit-only try/catch that never proves the run exit code is unaffected.

Deferred to first consumer: whether plan/review/prompt/shrink spawns also reap — pin when a caller needs it. This subspec scopes reaping to the patch iteration loop and finalize per the intent; the marker is inherited by every spawn but only the patch loop reaps.

## Tasks

- Generate a run-scoped id once per `runCommand`; pass a per-spawn marker value (`<run-id>:<iteration>:<spawn-seq>`) into each agent invocation via `AgentRunOptions`.
- In `runAgent`, set `JARVIS_RUN_ID=<value>` on the assembled spawn env so all descendants inherit it.
- Add a best-effort reap helper: list processes with their env (`ps -A -o pid= -o command= eww`), match the exact `JARVIS_RUN_ID=<value>` token, SIGKILL matches, return the killed count; never throw; never log scanned env (only killed count + own marker).
- Call reap from `runIteration`'s per-iteration `finally` and from `runCommand`'s finalize `finally`; make the reap entry point test-overridable (parallel to `__testKillGraceMs`).
- Net-new fixture (non-trivial): an escapee descendant that (a) carries the marker, (b) escapes its process group via `perl -MPOSIX -e 'POSIX::setsid()'` (darwin lacks a `setsid` binary), and (c) survives the existing `-pgid` kill — proving group sweep misses it and marker reap catches it at iteration end / finalize.
- Net-new test (non-trivial): force the overridable reap entry point to throw and assert the run's exit code is unchanged.
- Update docs listed below.

## Acceptance criteria

- [ ] Every agent invocation runs with an inheritable `JARVIS_RUN_ID` env marker whose value is unique to the run, iteration, and spawn.
- [ ] A descendant that re-parents to init (PPID=1, own session via `POSIX::setsid()`) and survives the `-pgid` group kill, carrying the marker, is SIGKILLed by the harness at iteration end and/or finalize rather than left running.
- [ ] Marker-based reaping runs in the per-iteration `finally` (covering settle, abort/timeout, and every other iteration exit) and in run finalize (covering the SIGINT and direct-`process.exit` paths).
- [ ] A reaping failure (process listing or kill error) does not change the run's exit code or stop reason.
- [ ] Reaping targets only processes carrying this run's own `JARVIS_RUN_ID` value; the harness's own process, processes without the marker, and other runs' markers are never targeted.
- [ ] Reaping never logs or stores scanned process environments or matched env lines; emitted diagnostics are limited to the killed-pid count and this run's own marker value.
- [ ] Existing watchdog, iteration-timeout, run-timeout, and finalize behavior is unchanged: the watchdog still logs `[watchdog] iteration timeout fired after Nms; killing agent pgid <pgid>`, group SIGTERM→SIGKILL escalation still occurs, and timeout/finalize exit codes are unchanged.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: state that the harness reaps agent descendants (including re-parented orphans that escaped the process group) via an inherited per-spawn `JARVIS_RUN_ID` env marker, discovered by an env-bearing process listing and SIGKILLed in the per-iteration `finally` (all exit paths) and at finalize; best-effort, non-fatal, exit codes unchanged, and it never logs scanned environments.
- `v1/docs/agents.md`: note the inheritable `JARVIS_RUN_ID` env marker tagging every agent invocation for orphan reaping, in the abort/process-lifecycle context. Make clear it is distinct from the existing prompt-appended HTML-comment usage-correlation marker (different purpose: process discovery vs. session correlation).
- `v2/docs/v1-behaviors.md`: under "Abort and process lifecycle", record marker-based orphan reaping as current v1 behavior (inherited per-spawn marker, env-listing discovery, reap in per-iteration `finally` and finalize, no environment logging, best-effort, exit codes unchanged).
