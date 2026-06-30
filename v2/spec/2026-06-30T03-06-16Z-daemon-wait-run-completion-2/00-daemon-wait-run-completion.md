# 00 — Daemon wait run-completion RPC

One-shot run-control RPC: block until a run hits an invocation quiescent edge
(`loop_finished` or `run_execution_failed`), then return `loop_finished` fields
plus durable `runStatus`. Multiple concurrent waiters on the same run all
resolve at the same terminal edge; socket disconnect or subscription abort
detaches only that waiter.

## Prerequisites

- Cross-process `follow` wakes detached clients on new log appends.
- Structured log stream emits terminal `loop_finished` with `loopOutcomeKind`,
  `iterationsConsumed`, and `resumable`.
- State store runs rows carry durable terminal status.
- Daemon run-control typed IPC serves existing run verbs over Unix socket.

## Decisions

- `wait` is an additive RPC alongside existing run-control verbs — rules out
  changing `start`/`list`/`pause`/`resume`/`kill` or log event shapes.
- **Invocation-boundary completion** — resolve at each persisted quiescent edge
  (`loop_finished` or `run_execution_failed`), including resumable stops — rules
  out lifecycle-completion blocking through `paused`/`killed`/`budget-soft-stopped`.
- **Immediate vs blocking predicate:** blocking when durable `runStatus ===
  "in-progress"`; immediate when `runStatus !== "in-progress"` — rules out
  private `isTerminalRunStatus` as normative contract and lifecycle-only
  immediate paths.
- Terminal resolve payload combines persisted `loop_finished` fields
  (`loopOutcomeKind`, `iterationsConsumed`, `resumable`) with durable
  `runStatus` read at resolve time — rules out a parallel outcome taxonomy.
- Immediate path reads the last terminal log signal from `tail(runId)` (last
  `loop_finished`, else last `run_execution_failed` only) plus current durable
  row — rules out hanging on quiescent runs.
- **Blocking subscribe cursor:** capture `subscribeSeq` from `tail(runId)` last
  `seq` before `follow`; resolve only on terminal log signal with `seq >
  subscribeSeq` — rules out replay of historical `loop_finished` on resumed runs.
- In-progress waits block on `logReader.follow(runId, signal)` filtered by
  subscribe cursor — rules out polling durable status alone.
- Primary terminal log signal is `loop_finished`; `run_execution_failed` also
  resolves when present without `loop_finished` — rules out wait hanging on
  spawn-boundary failures.
- `run_execution_failed` and kill-before-log resolve with durable `runStatus`
  only; omit `loopOutcomeKind`/`iterationsConsumed`/`resumable` when no
  `loop_finished` exists — rules out inventing synthetic loop outcome fields.
- `budget-soft-stopped` immediate path returns last `loop_finished` plus
  `runStatus: "budget-soft-stopped"` — rules out blocking until lifecycle
  terminal.
- Concurrent waiters on one `runId` share one terminal fan-out; each RPC gets
  the same resolve payload — rules out first-waiter-wins or single-slot wait.
- Per-run waiter registry drops when the last pending waiter resolves or
  detaches — rules out leaking fan-out state after all waiters gone.
- Socket disconnect or in-process `AbortSignal` on the waiter's `follow`
  subscription detaches only that waiter — rules out cancelling the hosted run,
  other waiters, or a wire-level abort param.
- **Long-running IPC:** handler returns pending; server emits `{ kind:
  "response", id, result }` on the same request `id` when the wait resolves —
  rules out stream-shaped wait and synchronous handler return.
- `loadRun` gate before any blocking `follow`; unknown `runId` → `unknown_run`
  — rules out indefinite hang on missing runs.
- `wait` with missing/empty `runId` → `invalid_params` — rules out silent
  accept of malformed params.
- In-process tests may use working handler/method names; stable external names
  deferred to CLI subspec as first external caller.

## Task checklist

- Extend IPC dispatch so handlers may return pending and defer `{ kind:
  "response", id, result }` on the same request `id`.
- Add `wait` handler with `{ runId: string }` params; validate `runId` before
  `loadRun`/`follow`.
- Immediate path: `loadRun`; when `runStatus !== "in-progress"`, read last
  terminal signal from `tail(runId)`, return combined payload.
- Blocking path: `subscribeSeq = tail(runId)` last `seq`; `follow(runId,
  signal)` until terminal signal with `seq > subscribeSeq`; re-read durable
  `runStatus` at resolve; fan out to all pending waiters on that run.
- Wire socket disconnect / subscription abort to detach individual pending waits;
  detached waiters send no RPC response.
- Drop per-run waiter registry when the last waiter resolves or detaches.
- Co-locate tests: immediate quiescent (paused/kill/budget-soft-stop),
  blocking until next edge on resumed run, concurrent waiters, disconnect
  detach, `run_execution_failed`, kill-without-`loop_finished`, unknown/missing
  `runId`, pending wait alongside other RPCs on one connection.

## Acceptance criteria

- [ ] `wait` on a run with `runStatus === "in-progress"` returns only after a persisted terminal log signal with `seq` greater than the subscribe cursor; the response includes that signal's `loopOutcomeKind`, `iterationsConsumed`, and `resumable` (when `loop_finished`) plus durable `runStatus` at resolve time.
- [ ] `wait` on a resumed in-progress run (prior `loop_finished` rows in the log) blocks until the next terminal log signal after subscribe, not the replayed historical edge.
- [ ] `wait` on a quiescent run (`runStatus !== "in-progress"`, including `paused`, `killed`, and `budget-soft-stopped`) returns immediately without blocking; the response includes the last persisted `loop_finished` fields (when present) and current durable `runStatus`.
- [ ] Two concurrent `wait` calls on the same in-progress run both resolve when the run hits the next terminal edge, each with the same terminal payload.
- [ ] Disconnecting a client blocked on `wait` sends no RPC response for that request, does not change the run's durable status, and does not prevent other waiters on that run from resolving at the terminal edge.
- [ ] `wait` on a run that ends with `run_execution_failed` and no `loop_finished` resolves with `runStatus: "failed"` and omits `loopOutcomeKind`, `iterationsConsumed`, and `resumable`.
- [ ] `wait` on a run with durable terminal `runStatus` (`killed` or `failed`) and no persisted `loop_finished` resolves with that `runStatus` only and omits `loopOutcomeKind`, `iterationsConsumed`, and `resumable`.
- [ ] `wait` with a missing or empty `runId` returns `invalid_params`; `wait` with an unknown `runId` returns `unknown_run` before any blocking `follow`.
- [ ] A client with a pending `wait` on one connection can send and receive other RPCs on that same connection while the wait is open.
- [ ] Existing run-control verb behavior is unchanged (`daemon-start-list.test.ts`, `daemon-run-failure-capture.test.ts`, and `daemon-tail-stream.test.ts` stay green).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Interface/Steering: `wait` verb,
  invocation-boundary completion, subscribe-cursor blocking, concurrent-waiter
  fan-out, disconnect detach semantics; cross-link `daemon-host.md` for wire
  `result` fields.
- `v2/docs/daemon-host.md` — add `wait` to the RPC methods table with flat
  `result` contract:
  - Always present: `runStatus` (durable at resolve time).
  - Present when last terminal signal is `loop_finished`: `loopOutcomeKind`,
    `iterationsConsumed`, `resumable`.
  - Omitted when resolve is from `run_execution_failed` only, kill-before-log,
    or other terminal durable row without a persisted `loop_finished`.
  - Params: `{ runId: string }`. Errors: `invalid_params`, `unknown_run`.
  - Long-running: response deferred on the same request `id`; other RPCs on the
    connection proceed while wait is pending.
- Inline doc-comments on new exported symbols per
  `v2/docs/documentation-standard.md`.
