---
name: supersede-reaches-a-socketless-resident-daemon
---

# Supersede is addressed by socket file, so a daemon that released its socket is never retired

## Problem

Daemon supersede is discovered and delivered purely by socket file. `enumerateOtherDaemonSockets` (`v2/src/daemon/daemon-peer-socket.ts:6`) lists `daemon-<16hex>.sock` entries under `~/.jarvis` and returns everything but its own path; `supersedePeerDaemon` then RPCs each one, ignoring every error.

A daemon that has already unlinked its socket but has not exited is invisible to that pass. It receives no `supersede`, keeps admitting work, and keeps its worktree leases — while the operator, and every CLI verb, can only reach the new daemon.

Reported as [#3595](https://github.com/cbrenner04/jarvis/issues/3595): two `daemon-entrypoint.ts` processes resident ~40 minutes, the old one having cleanly removed its own socket.

## What it costs

Three operator-visible failures, one cause:

1. **A dispatched run is swallowed.** Run `33a03ee5` was admitted by the *old* daemon at `2026-09-08T03:45:11.422Z`, the moment the new one came up. Its complete run log is a single `iteration_started` record. The worktree materialized with baseline files and a clean tree — no agent invocation, no further events — and `run list` against the reachable daemon never showed it.
2. **The lease outlives the reachable daemon.** Re-dispatch refused `worktree is in use by process 98680` (`WorktreeBusyError`, `external-worktree.ts:39`), which keys on the recorded pid being live. The pid *was* live — it was the unreachable daemon.
3. **No in-tool resolution.** `run kill` on the reachable daemon returned `run_not_active` (it does not own the run), and re-dispatch was blocked by the lease. The only recovery was an out-of-band `kill <pid>`.

Per the reporter's follow-up, the row does eventually settle `killed` / `resumable_kill` — but only after the orphaning daemon is killed and the survivor reconciles. The defect is the window, not the end state: for as long as the old daemon lives, the row rests `in-progress` and the operator has no supported way out.

Note that supersede is also only an *admission* stop: `daemon_superseded` refuses new `start`/`resume`, but a superseded daemon keeps running and keeps its leases by design. Delivery is therefore necessary but not sufficient — the lease must also be reclaimable.

## Decisions

- Peer discovery enumerates live daemons from a durable per-digest record (the pid file already written when a daemon begins serving), not from the presence of a socket file; rules out a liveness test that a daemon can fail simply by having unlinked its own socket.
- A superseded daemon with no active runs exits rather than resting resident; one with active runs exits once they settle; rules out an indefinitely resident daemon holding leases nothing can reclaim.
- Admission closes before the socket is released, so there is no window in which a daemon is both unreachable and still accepting `start`; rules out the changeover race that swallowed run `33a03ee5`.
- A worktree lease whose holder is a daemon that is superseded or unreachable is reclaimable through the ordinary re-dispatch path; rules out an out-of-band `kill` being the only recovery. Liveness of the recorded pid alone is not sufficient evidence that the holder can still make progress.
- `run kill` on a run whose owning daemon is unreachable settles the durable row instead of refusing `run_not_active`; rules out a row the operator can neither kill nor re-dispatch.
- This is distinct from [[superseded-daemon-releases-run-ownership]] (ownership hand-off for runs a superseded daemon still owns) and from #3030 (reconciliation flipping a paused resumable run); both assume supersede was *delivered*. Rules out folding delivery into either.

## Acceptance criteria

- [ ] A test proves peer enumeration returns a daemon whose pid file records it as serving but whose socket file is absent; it fails against the current socket-glob discovery.
- [ ] A test proves a superseded daemon with no active runs exits, and one with an active run exits after that run settles; it fails against the current indefinitely-resident behavior.
- [ ] A test proves a daemon that has begun releasing its socket refuses `start` rather than admitting a run; it fails against the pre-fix changeover race.
- [ ] A test proves worktree-lease acquisition succeeds when the recorded holder pid is live but that daemon is superseded or unreachable, and still refuses when the holder is a live admitting daemon; it fails against the current live-pid-only `WorktreeBusyError`.
- [ ] A test proves `run kill` settles a durable row whose owning daemon is unreachable rather than returning `run_not_active`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — peer discovery source, supersede delivery, and superseded-daemon exit contract.
- `v2/docs/operator-runbook.md` — § Daemon lifecycle: a socket-less resident daemon is superseded normally; drop the implication that an out-of-band `kill` is the recovery for an orphaned lease.
- `v2/docs/v1-behaviors.md` — record the changed supersede and lease-reclaim behavior.
