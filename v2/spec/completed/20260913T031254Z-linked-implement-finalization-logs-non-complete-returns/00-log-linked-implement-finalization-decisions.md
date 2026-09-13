# Log linked-implement finalization decisions

## Problem

`finalizeLinkedImplementPass`'s two failure branches (`link_incomplete` → `contract_miss`, `index_routing_mutated` → `blocked`) and `linkedImplementRoutingFailureOutcome`'s reused-run branch (a routing failure after a link's write loop already completed) act on a runId that `settleNonCompleteWorkflowStep` already settles with `run_execution_failed` plus a corrected `loop_finished` naming the cause — only the *producer* is missing there. `linkedImplementRoutingFailureOutcome`'s fresh-run branch — the top-of-loop routing check before any write loop has run for the link, and the *only* source of `empty_index` and `already_complete` — mints a `crypto.randomUUID()` that is never persisted to the state store (`workflow-runner-debate.test.ts`'s "returns a routing failure whose run id was never persisted without throwing" test already pins `store.loadRun(result.runId)` as `null` for it). Nothing logged under that id is reachable through `jarvis run log` (`createTailStreamHandler` closes the stream immediately when `stateStore.loadRun` misses). That branch stays out of scope here; see Decisions.

## Decisions

- Add one `linked_implement_finalization` log event (`v2/src/persistence/log-stream.ts`, modeled on the existing `IntentFinalizationEvent`): `producer: "pass_finalization" | "routing"`, `reason: "link_incomplete" | "index_routing_mutated" | "link_unreadable" | "malformed_link"` (the bare `errorKind`/finalizer cause, never the `implement.<kind>: <message>`-prefixed `routingFailure` string), `outcomeKind: "contract_miss" | "blocked"`; rules out an event whose machine-readable cause the reader must cross-reference against `routingFailure` prose to recover.
- Emit only where the runId already resolves through `store.loadRun` at return time: `finalizeLinkedImplementPass`'s two branches, and `linkedImplementRoutingFailureOutcome`'s reused-run branch (called with `existingRunId` — the pinned re-check after a link's write loop completed); rules out logging under a runId `jarvis run log` can never reach.
- `linkedImplementRoutingFailureOutcome`'s fresh-run branch (`existingRunId` undefined) stays out of scope: it has no durable row to attach a fetchable event to, and creating one is a row-creation/settlement change this diagnostic-only subspec does not make. This is the sole source of `empty_index`/`already_complete`, so those two reasons stay unlogged by this event; an operator who sees `index_routing_mutated`/`link_incomplete`/a reused-run routing reason gets a named producer, and by elimination an unlabeled non-complete or review-ineligible-complete outcome is one of the fresh-run reasons.
- Add a `linked_implement_finalization` case to `formatLogFollowLine` (`v2/src/tui/tui-log-follow-lines.ts`) printing `producer`, `reason`, `outcomeKind`; rules out the TUI log view showing only `kind` for this event.
- Each covered return site appends exactly one `linked_implement_finalization` event before returning; rules out double-logging or dropping the event on one branch of a shared helper.
- Keep workflow outcome kinds, routing diagnostics, index restoration, review eligibility, and row settlement unchanged; rules out using observability work to alter control flow.

## Tasks

- Define the event on the durable `LogEvent` union and add the `formatLogFollowLine` case.
- Append the event from `finalizeLinkedImplementPass`'s two branches and from `linkedImplementRoutingFailureOutcome`'s reused-run branch, before each returns.
- Add focused workflow regressions for `link_incomplete`, `index_routing_mutated`, and one reused-run routing reason (e.g. `malformed_link`), each proving the event is fetchable through the durable run-log read path, not just the captured `logSink` call.
- Add a `formatLogFollowLine` test for the new event kind (no existing test file covers this formatter).
- Align durable operator and v1 parity documentation.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-debate.test.ts` drives `link_incomplete`, `index_routing_mutated`, and a reused-run routing failure (e.g. `malformed_link`, dropping the pinned link from the index after its write loop completes), then for each asserts `linked_implement_finalization` is appended with the expected `producer`, `reason`, and `outcomeKind`, verified by reading it back through the durable log-read path (`store.loadRun` resolves the runId, then the log reader's `tail`/equivalent returns the record) rather than only the captured append call; it fails against the pre-fix code.
- [x] The existing "returns a routing failure whose run id was never persisted without throwing" test in the same file still passes unchanged: the fresh-run routing-failure path appends no `linked_implement_finalization` event and `store.loadRun(result.runId)` still resolves `null`.
- [x] `v2/src/persistence/log-stream.test.ts` proves the structured `linked_implement_finalization` payload is accepted by `LogEvent` and survives a durable log round-trip.
- [x] A `formatLogFollowLine` test asserts the rendered line for a `linked_implement_finalization` record includes `producer`, `reason`, and `outcomeKind`.
- [x] Existing linked-implement routing and settlement coverage in `v2/src/execution/workflow-runner-debate.test.ts` stays green (outcomes and routing semantics unchanged).
- [x] `v2/docs/write-behavior.md` documents when `linked_implement_finalization` is emitted, its field meanings, the `jarvis tui log` line format for it, and that the fresh-run routing branch (all `empty_index`/`already_complete` outcomes) is out of scope because it has no durable row to attach a fetchable event to.
- [x] `v2/docs/v1-behaviors.md` catalogs the additive linked-implement finalization diagnostic and its scope boundary without changing the recorded routing contract.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — document the linked-implement finalization event, producer and reason values, final outcome, the `jarvis tui log` rendering, and the fresh-run scope exclusion.
- `v2/docs/v1-behaviors.md` — catalog the additive durable diagnostic alongside linked-index routing behavior, noting the scope boundary.
