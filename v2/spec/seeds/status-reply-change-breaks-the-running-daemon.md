# A status-reply change makes the running daemon unreachable and misreported as stopped

## Problem

Merging the executable-tree digest guard (#1880) changed the `status` RPC contract: the CLI now
sends `{ currentRevision, currentExecutableDigest }` and **requires** `loadedExecutableDigest` in
the reply (`v2/src/cli/dispatch-revision.ts:54`), throwing otherwise:

```ts
if (status?.loadedRevision === undefined || status.loadedExecutableDigest === undefined) {
  throw new RpcConnectionError("malformed RPC reply: invalid daemon status result");
}
```

A daemon started before that merge does not send the new field. So immediately after merging,
every new-CLI interaction with the still-running old daemon fails, and the failure is
self-defeating: **the revision-mismatch detection that exists to handle "the daemon is running old
code" is itself disabled by the daemon running old code.** It throws before it can compare
anything, so auto-bounce never fires.

Observed 2026-07-21, immediately after #1880 merged. Two dispatches died:

```console
$ jarvis run workflow intent --seed … --review-passes 1 --review-behavior light
malformed RPC reply: invalid daemon status result
$ jarvis run workflow implement --base main --spec … --review-passes 1 --review-behavior debate
malformed RPC reply: invalid daemon status result
```

And the operator surfaces disagreed about whether a daemon existed at all:

```console
$ jarvis daemon status
stopped                      # wrong — a daemon was running
$ jarvis daemon start
DaemonAlreadyRunningError: Daemon already running on socket …/daemon.sock
```

`status` reports a live daemon as `stopped` because it cannot parse the reply, while `start`
refuses because the socket is held. An operator following the runbook's session-start step
(`status` → start if stopped) is told to start a daemon that is already running, and is given no
signal that the real problem is a version skew. `jarvis daemon stop` did work and recovery was
`stop` then `start`, but nothing pointed there.

## Decisions

- Treat a missing or unparseable new field as a **version skew**, not a malformed reply: report a
  named, actionable error that says the daemon predates the current CLI and must be bounced, and
  let the existing auto-bounce path handle it when no run is live. Rules out throwing a transport
  error for a contract the daemon simply does not know yet.
- `jarvis daemon status` must distinguish "no daemon" from "a daemon is running but does not speak
  this CLI's protocol"; it must never report a live daemon as `stopped`.
- Version the status contract explicitly so the skew is detectable rather than inferred from a
  missing field. Pin the mechanism in the plan — a protocol version integer in the reply is the
  obvious candidate.
- Additive status fields must degrade to a skew diagnosis, not a hard failure; a regression should
  pin that a reply missing a newer field yields the skew path.
- Rules out requiring the operator to know which merge changed the wire format.

## Acceptance criteria

- [ ] A CLI talking to a daemon whose status reply lacks a newer field reports a named version-skew
      error naming the remedy, not `malformed RPC reply`.
- [ ] With no live run, that skew triggers the existing auto-bounce and the dispatch is retried.
- [ ] With a live run, it refuses and names the live run IDs, as a genuine mismatch does today.
- [ ] `jarvis daemon status` reports a running-but-skewed daemon distinctly from `stopped`, and
      never reports a live daemon as `stopped`.
- [ ] `jarvis daemon start` against a running skewed daemon gives the same skew diagnosis rather
      than `DaemonAlreadyRunningError`.
- [ ] Regression coverage drives a status reply missing the newer field and pins the skew path.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — status contract versioning and skew handling.
- `v2/docs/operator-runbook.md` § Recovery — the `stop` then `start` recovery, and that `status`
  can misreport a skewed daemon.
