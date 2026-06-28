---
name: run-completion-notify
---

# Run completion wait + notify primitive

Add a **push** completion signal to the daemon run-control surface: a way for a
client to learn a run reached a terminal boundary *without* hand-rolling a poll
loop or holding open a full log `follow` stream. This is a thin superset over the
merged Phase 3 verbs, motivated by how operators actually use jarvis today.

Source of truth: extends `v2/spec/seeds/phase-3-daemon-host.md` (run-control
scope 3) and `v2/spec/ready-intents/daemon-run-control-api.md`; consumes the
`loop_finished` event from `v2/spec/.../structured-log-stream/00-log-stream.md`.
Picks up the explicitly deferred *cross-process `follow` wake* item from
`00-log-stream.md` ("pin in Phase 3 daemon refine before daemon tail ships").
Done condition is merged code in `v2/src`, not this seed.

## Why now (usage drift)

Phase 3 replaced ad-hoc polling with *follow-the-stream*: an operator opens
`log`(tail/follow) and watches for `loop_finished`. In practice operators run
jarvis as a fleet of background runs and repeatedly ask one question — **"is run
N done yet, and how did it end?"** Follow-the-stream is an awkward fit for that:
it streams every boundary/iteration event just to observe one terminal edge, and
each operator improvises a different "wait until finished" wrapper around it.
This seed makes the terminal signal a first-class, uniform primitive.

## What exists today (after Phase 3 merges)

- Structured log stream with a terminal `loop_finished` event carrying
  `loopOutcomeKind` (`complete` / `blocked` / `contract_miss` /
  `invocation_failure` / `budget-exhausted`), `iterationsConsumed`, `resumable`
  — keyed by `runId`, readable via `tail`/`follow`.
- State store `runs` rows carry durable terminal status
  (`completed` / `blocked` / `failed` / budget-soft-stopped / `in-progress`).
- Daemon run-control verbs: `start` / `list` / `tail log` / `pause` /
  `resume` / `kill` over typed Unix-socket IPC; daemon owns the `AbortSignal`.
- `list` merges durable state rows with in-memory liveness — the only current
  way to ask "is it still running" is to call `list` again (poll).

Gap: there is no way to be *told* when a run finishes. Clients either poll
`list` or consume a full `follow` stream and filter for `loop_finished`.

## Scope

A push/wait primitive over the **unchanged** core and **already-merged**
run-control API — additive verbs only.

1. **`wait <runId>` RPC.** One-shot: resolves when the run reaches a terminal
   boundary, returning the terminal outcome (the `loop_finished` payload shape
   plus the durable `runStatus`). For an *already-terminal* run it resolves
   immediately from durable state — no hang. For an unknown `runId`, mirror the
   log-reader posture (resolve to a "not found"/empty result, not an error) or a
   single explicit error variant — settle in refine, but pick one and be
   consistent with `tail`/`follow`.

2. **Cross-process `follow` wake.** Make the log reader's `follow` (and this
   `wait`) wake a *separate client process* on new appends from the daemon's
   writer — closing the deferred item in `00-log-stream.md`. In-process proofs
   from Phase 3 are not sufficient once a detached CLI/TUI is the consumer.

3. **CLI surface.** A `jarvis wait <runId>` (or `--wait` flag on an existing
   command — settle in refine) that blocks until terminal and exits with a code
   reflecting the outcome kind (e.g. `0` complete, non-zero for
   blocked/failed/budget) so it composes in shell/fleet scripts. Thin client
   over the RPC; no orchestration logic.

4. **Multi-waiter + lifecycle.** Multiple clients may `wait` the same run
   concurrently; all resolve on the terminal boundary. A `wait` whose client
   disconnects (or whose `AbortSignal` fires) detaches cleanly without affecting
   the run or other waiters.

## Explicitly out of scope (do not build ahead of a consumer)

- **External delivery** — webhooks, HTTP callbacks, email/Slack/desktop push,
  any network egress. Stays hermetic over the existing Unix socket; no broker,
  no network port (same posture as `daemon-host-ipc`).
- **Subscribe-to-many / topic bus** — no generic pub/sub across all runs or a
  filtered subscription language. `wait` is keyed by a single `runId`; observing
  many runs is the client calling `wait`/`list` per run. Revisit only if a real
  consumer (TUI dashboard) needs a multiplexed feed.
- **Non-terminal event subscriptions** — "notify on each boundary",
  "notify on blocked-needing-human" — that is steering/human-loop territory
  (Phase 6); this seed signals only the terminal edge.
- **Concurrency / admission / `queued` notifications** — Phase 7.
- **Changes to the core or state-store schema** — `executeWriteLoop` stays
  daemon-unaware; reuse durable run status + the log stream as the source of the
  terminal signal. No new orchestration columns.

## Design posture (be careful here)

This is a *superset* of the merged run-control API, not an edit to it — implement
`wait` on top of `loop_finished` + durable run status, do not redefine the verbs
or the event shape. Resist generalizing into a subscription framework: the
motivating consumer is "tell me when this one run is done," so build exactly
that. The terminal-signal source already exists twice over (durable status +
`loop_finished`); the work is exposing it as a push/wait edge and making
`follow` wake across processes — not inventing a new taxonomy.

## Documentation updates

- `v2/docs/v2-architecture.md` — Interface/Steering: record the `wait`/notify
  verb and that cross-process `follow` wake is now settled (reconcile with the
  `00-log-stream.md` deferral note).
- `v2/spec/v2-meta-index.md` — only if this is tracked as its own phase/line;
  otherwise it rides as a Phase 3 follow-up (operator decides at intake).
- `v2/docs/v1-behaviors.md` — no change expected; additive v2-only code.

## Prerequisites

- Phase 3 merged: structured log stream (`loop_finished`), daemon + typed IPC
  (request/response **and** streaming), and the run-control API
  (`start`/`list`/`tail`/`pause`/`resume`/`kill`).
- Resumable write loop with durable terminal run status in the state store.
