# Key the daemon by executable digest instead of bouncing it

## Problem

The daemon is a long-lived process pinned to a code snapshot, serving CLI clients that float with
the working tree. There is no compatibility strategy between them, so every merge is an unmanaged
upgrade against a running process. The symptoms are all the same defect:

- **Dispatch halts on any merge.** A revision mismatch refuses new work; with a live run the daemon
  cannot bounce, so nothing can be dispatched until every run drains. Blocked work four separate
  times on 2026-07-21, including on a markdown-only merge.
- **The bounce ritual.** "Bounce the daemon after merging any v2 change" is operator toil that
  exists only because one daemon must serve every revision.
- **Upgrades can break the running daemon outright.** Adding a required field to the `status` reply
  made the running daemon unreachable *and* misreported as `stopped`, and disabled the very
  mismatch check meant to handle a stale daemon (seed
  `status-reply-change-breaks-the-running-daemon`).

Each has been patched at the symptom. The cause is that one socket serves all revisions, and
compatibility is decided *after* connecting, by comparing values in a reply whose shape is assumed.

## Prior art

This is the standard build-daemon problem and there are two accepted answers:

- **Version-keyed instances.** Gradle reuses a daemon only when its version and JVM parameters match
  the request, otherwise starts a new one; idle daemons expire. Bazel keys its server by output base
  and startup options and restarts on change. Mismatched pairs never talk.
- **Negotiated protocol.** Docker versions its API and the client downgrades into the server's
  supported range; LSP negotiates capabilities at `initialize`; Kubernetes publishes a version-skew
  policy.

Negotiation exists for systems that cannot couple client and server deploys — many clients, remote
server, independent cadence. Jarvis is one operator, one machine, a local socket, and both sides
built from the same checkout, so the keyed-instance model is the cheaper and stronger fit. Confirm
Gradle's current daemon-compatibility rules when implementing; they are the closest analogue.

## Decisions

- Key the daemon socket by the executable-tree digest (`daemon-<digest>.sock`), reusing the digest
  from `shared/executable-tree.ts`. A client connects only to a daemon built from its own
  executable tree, so version skew is structurally impossible rather than diagnosed.
- A daemon that no longer matches any client keeps its **in-flight runs to completion**, accepts no
  new work, and exits when idle. Rules out draining, migrating, or handing off live runs — the
  prior art does not do this, and the ownership transfer (worktree locks, agent process handles,
  log sinks) is where the complexity would be.
- **The TUI is the operator's live surface and must show every run across every live daemon**,
  merging results from all sockets. It must also follow supersession without being restarted: when
  a new daemon takes over new work, the running TUI picks it up and keeps rendering both until the
  old one exits. This is the part with no off-the-shelf precedent — build daemons are not asked
  "what is running everywhere?" — and it is the requirement that matters most here.
- `run list` and `run wait` may stay scoped to the daemon they connect to; they are not the
  operator's observation path and do not need cross-daemon aggregation. Rules out paying for
  merge semantics on three surfaces when only one is used live.
- Cleanup reaps sockets whose daemon has exited.
- Migration: an existing unkeyed `daemon.sock` from a pre-change daemon must be handled explicitly —
  adopted, stopped, or ignored — and the choice pinned in the plan. This ships *into* a running
  daemon that predates it, which is precisely the failure this seed exists to end.
- Retire the mismatch/auto-bounce machinery and its operator ritual once keying lands; the digest
  becomes a key, not a comparison.
- Rules out protocol negotiation for this repo; revisit only if a remote or multi-machine daemon
  becomes real.

## Acceptance criteria

- [ ] A CLI connects only to a daemon whose executable digest equals its own; a non-matching daemon
      is never contacted.
- [ ] Dispatch after a merge starts or reuses a matching daemon and proceeds, with live runs present
      on another daemon and no bounce.
- [ ] A superseded daemon finishes its in-flight runs, refuses new work, and exits once idle.
- [ ] The TUI reports runs across all live daemons in one view.
- [ ] A running TUI survives supersession without restart: it picks up the new daemon and continues
      rendering runs owned by both until the superseded one exits.
- [ ] `run list` and `run wait` behave correctly when scoped to their connected daemon.
- [ ] Cleanup removes sockets whose daemon is gone, and never removes a live one.
- [ ] Upgrading from an unkeyed `daemon.sock` follows the pinned migration path without an operator
      command.
- [ ] No revision-mismatch refusal or auto-bounce path remains reachable from dispatch.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — socket keying, supersession, and idle exit.
- `v2/docs/operator-runbook.md` — delete the bounce-after-merge instruction and the
  cannot-bounce-while-live recovery; describe multi-daemon `run list`.
- `v2/docs/v1-behaviors.md` — record the changed daemon lifecycle.
