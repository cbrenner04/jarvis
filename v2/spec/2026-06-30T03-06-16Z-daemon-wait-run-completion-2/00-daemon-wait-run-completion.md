# 00 — Daemon wait run-completion RPC

One-shot run-control RPC: block until a run hits a terminal boundary, then return
`loop_finished` fields plus durable `runStatus`. Multiple concurrent waiters on
the same run all resolve at the terminal edge; client disconnect or abort
detaches only that waiter.

## Decisions

- `wait` is an additive RPC alongside existing run-control verbs — rules out
  changing `start`/`list`/`pause`/`resume`/`kill` or log event shapes.
- Terminal resolve payload combines persisted `loop_finished` fields
  (`loopOutcomeKind`, `iterationsConsumed`, `resumable`) with durable
  `runStatus` read at resolve time — rules out a parallel outcome taxonomy.
- Already-terminal runs (per `isTerminalRunStatus`) resolve immediately from
  persisted log + durable row without blocking on `follow` — rules out hanging
  on completed runs.
- In-progress waits block on `logReader.follow` until a terminal log signal —
  rules out polling durable status alone and missing the terminal edge.
- Primary terminal log signal is `loop_finished`; `run_execution_failed` also
  resolves wait when present without `loop_finished` — rules out wait hanging
  on spawn-boundary failures (pins deferred item from run-failure-capture).
- `run_execution_failed` resolve includes durable `runStatus` (`failed`); omit
  `loopOutcomeKind`/`iterationsConsumed`/`resumable` when no `loop_finished`
  exists — rules out inventing synthetic loop outcome fields.
- Concurrent waiters on one `runId` share one terminal fan-out; each RPC gets
  the same resolve payload — rules out first-waiter-wins or single-slot wait.
- Client disconnect or request abort detaches only that waiter — rules out
  cancelling the hosted run or other waiters.
- `wait` holds the RPC request open until resolve or client disconnect — rules
  out closing early with a snapshot that misses a later terminal edge.
- In-process tests may use working handler/method names; stable external names
  deferred to CLI subspec as first external caller.
- Deferred to first consumer: unknown-`runId` posture (empty vs explicit error)
  — pin in refine; must match log-reader/tail posture for the chosen variant.

## Task checklist

- Add `wait` handler to run-control factory (or sibling factory merged into
  `startDaemon` handlers) with `{ runId: string }` params.
- Immediate path: load run; when terminal, read last `loop_finished` from
  `tail(runId)` (or `run_execution_failed` only), return combined payload.
- Blocking path: `follow(runId, signal)` until terminal log signal; re-read
  durable `runStatus` at resolve; fan out to all pending waiters on that run.
- Wire socket disconnect / abort to detach individual pending waits without
  affecting the run or other waiters.
- Extend IPC dispatch if needed so long-running `wait` can respond asynchronously.
- Co-locate tests: immediate terminal, blocking until finish, concurrent
  waiters, disconnect detach, `run_execution_failed` path.

## Acceptance criteria

- [ ] `wait` on an in-progress run returns only after `loop_finished` is persisted; the response includes that event's `loopOutcomeKind`, `iterationsConsumed`, and `resumable` plus the durable run's `runStatus` at resolve time.
- [ ] `wait` on a run already in terminal durable status returns immediately without blocking; the response includes the persisted `loop_finished` fields (when present) and current durable `runStatus`.
- [ ] Two concurrent `wait` calls on the same in-progress run both resolve when the run finishes, each with the same terminal payload.
- [ ] Disconnecting a client blocked on `wait` does not change the run's durable status or prevent other waiters on that run from resolving at the terminal edge.
- [ ] `wait` on a run that ends with `run_execution_failed` and no `loop_finished` resolves with `runStatus: "failed"` and does not invent `loopOutcomeKind`, `iterationsConsumed`, or `resumable`.
- [ ] Existing run-control verb behavior is unchanged (`daemon-start-list.test.ts`, `daemon-run-failure-capture.test.ts`, and `daemon-tail-stream.test.ts` stay green).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Interface/Steering: `wait` verb, terminal
  payload, concurrent-waiter fan-out, disconnect detach semantics.
- `v2/docs/daemon-host.md` — add `wait` to the RPC methods table.
- Inline doc-comments on new exported symbols per
  `v2/docs/documentation-standard.md`.
