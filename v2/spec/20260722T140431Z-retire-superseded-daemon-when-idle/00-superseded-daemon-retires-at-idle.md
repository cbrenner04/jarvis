# 00 - Superseded daemon closes admission and exits at idle

## Problem

`startDaemonRuntime` (`v2/src/daemon/daemon.ts`) has one terminal state: `shutdownRequested`, set by the `shutdown` RPC or SIGTERM/SIGINT, which closes and exits regardless of in-flight runs. Digest-keyed sockets let daemons coexist, but an older daemon has no way to stop admitting work while finishing what it owns, and no way to exit on its own once it owns nothing.

## Decisions

- Add a `supersede` RPC that flips the daemon into a retiring state; rules out inferring supersession from a filesystem marker or digest re-check poll, which cannot be ordered against the new daemon becoming ready.
- `supersede` is idempotent and always returns `{ ok: true }`; rules out an error on a second call, which would make the sender's broadcast order significant.
- Retiring rejects `start` (both `{ input }` and `{ steps }`) with `daemon_superseded` before any claim, run row, or worktree materialization; rules out admitting then immediately killing, which would leave durable rows and worktree debris.
- Retiring also rejects `resume`, with the same code: resume is admission of new execution, not steering; rules out treating resume as steering, which would keep pulling work into a daemon that is trying to exit. Paused, killed, and retryable rows stay resumable on the current daemon.
- Retiring stops promoting queued runs; queued rows stay `queued` for the current daemon to promote; rules out draining the queue through the retiring daemon.
- `list`, `wait`, log tail streams, `health`, `status`, `pause`, and `kill` keep working while retiring; rules out closing the socket at supersession, which would blind the operator to runs only this daemon can report live.
- Idle means the daemon's in-memory active-run set is empty; queued and paused durable rows do not hold it open; rules out reading durable run rows, which are shared across daemons and would keep a retired daemon alive for another daemon's work.
- Idle exit reuses the existing shutdown poll: retiring + idle sets the same shutdown path, so close and exit sequencing is unchanged; rules out a separate teardown path that could skip handler/server/store close.
- Process exit goes through an injectable seam on `DaemonStartupDeps` defaulting to `process.exit`; rules out calling `process.exit` directly, which makes the retirement path untestable in-process.
- Supersession changes admission only: run ownership, worktree locks, agent child processes, and log sinks stay with the admitting daemon and are untouched.

## Task checklist

- [ ] Expose active-run liveness from `createRunControlHandlers` and a retiring flag the admission handlers consult.
- [ ] Add the `supersede` handler and `daemon_superseded` rejections for `start` and `resume`; suppress queued promotion while retiring.
- [ ] Set the shutdown path when retiring and no active run remains; route exit through the new seam.
- [ ] Tests in `v2/src/daemon/daemon-lifecycle.test.ts` driving `startDaemonRuntime` with a stub IPC server: a daemon with an in-flight run stays up and serving after `supersede`, rejects `start`/`resume`, and exits only once that run settles; an idle daemon exits promptly on `supersede`.

## Acceptance criteria

- [ ] After `supersede`, `start` (write-loop and workflow forms) and `resume` are rejected `daemon_superseded`, and no durable run row, worktree claim, or materialized worktree is created for the rejected call.
- [ ] After `supersede`, `health`, `status`, `list`, `wait`, log tail, `pause`, and `kill` still answer for runs the daemon owns.
- [ ] A run in flight when `supersede` arrives reaches its normal outcome under the same daemon, with its worktree lock, agent process, and log sink unchanged.
- [ ] A superseded daemon with no active run exits without any operator action; one with an active run exits only after that run settles.
- [ ] Queued runs are not promoted after supersession and do not keep the daemon alive.
- [ ] A regression test in `v2/src/daemon/daemon-lifecycle.test.ts` proves the superseded daemon retires only after its owned run settles, and fails against the pre-fix code (no `supersede` method exists).
- [ ] Inverting each added guard (admission closure, queued-promotion suppression, idle-only exit) makes at least one test fail; the admission and promotion negative cases assert the rejected run row and the promotion are absent, not merely delayed.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `supersede` in the RPC method table, the `daemon_superseded` rejection on `start`/`resume`, and the retiring lifecycle (admission closed, observation and steering retained, exit at idle).
- `v2/docs/write-behavior.md` — operator-observable effect: a superseded daemon refuses new work while its owned runs finish.
- `v2/docs/v1-behaviors.md` — record daemon shutdown as no longer being shutdown-RPC/signal-only.
