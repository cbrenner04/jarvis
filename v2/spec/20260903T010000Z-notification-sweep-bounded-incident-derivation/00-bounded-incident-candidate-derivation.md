# Bounded incident candidate derivation

## Problem

`deriveOperatorIncidents` calls unbounded `listPipelines()` and `listRuns()` on every notification sweep, decoding full terminal history synchronously on the daemon event loop.

## Decision ledger

- `deriveOperatorIncidents` reads candidate rows through `listIncidentCandidatePipelines` and `listIncidentCandidateRuns` instead of `listPipelines` / `listRuns`; rules out full-history enumeration every sweep.
- Terminal candidate bound is `nowMs - ATTENTION_TERMINAL_RECENCY_MS` (12h, same window as TUI attention filtering); `sinceMs` is passed to both store queries; rules out a notification-only retention constant.
- `deriveOperatorIncidents` accepts optional `nowMs` (default `Date.now()`); `runNotificationSweep` forwards its `nowMs` clock; rules out wall-clock drift between sweep scheduling and candidate filtering within one tick.
- `ATTENTION_TERMINAL_RECENCY_MS` lives in a module importable by daemon and TUI (relocate from `tui-attention-rows.ts` or extract to a shared constant); rules out `daemon` importing `v2/src/tui/**`.
- Run query uses `RUN_STATUSES` with the store's terminal/non-terminal SQL rules unchanged; rules out in-memory status filtering after an unbounded load.
- Pipeline and run candidate bounds match the persistence query contracts exercised in `state-store.test.ts`; rules out re-deriving SQL filters in the daemon.

## Prerequisites

- Intent prerequisites: `listIncidentCandidateRuns`, `listIncidentCandidatePipelines`, `loadRunsByIds`, and `findRunsByInvocationIds` are observable on `StateStore`.

## Task checklist

- Wire `deriveOperatorIncidents` to `listIncidentCandidatePipelines({ sinceMs })` and `listIncidentCandidateRuns({ statuses: RUN_STATUSES, sinceMs })` with `sinceMs = nowMs - ATTENTION_TERMINAL_RECENCY_MS`.
- Thread optional `nowMs` through `deriveOperatorIncidents` and from `runNotificationSweep` deps.
- Relocate or extract `ATTENTION_TERMINAL_RECENCY_MS` so daemon incident derivation and TUI attention filtering share one constant without a daemon→tui import.
- Add `operator-notification.test.ts` regression `deriveOperatorIncidents excludes terminal runs outside the recency bound`: seed many old terminal runs plus a small actionable set; assert derived incidents contain only actionable rows; fails against pre-fix full-history derivation.
- Add `operator-notification.test.ts` regression `deriveOperatorIncidents store work is unchanged when old terminal history is padded`: instrument or spy store candidate-query calls; assert identical query count or rows decoded between a small store and one padded with old terminal rows sharing the same actionable set; fails against pre-fix unbounded enumeration.

## Acceptance criteria

- [ ] `v2/src/daemon/operator-notification.test.ts` test `deriveOperatorIncidents excludes terminal runs outside the recency bound` seeds many old terminal runs plus a small actionable set and asserts derived incidents contain only actionable rows; it fails against the pre-fix full-history derivation.
- [ ] `v2/src/daemon/operator-notification.test.ts` test `deriveOperatorIncidents store work is unchanged when old terminal history is padded` asserts store-query count or rows decoded is identical between a small store and one padded with old terminal rows whose actionable set is identical; it fails against the pre-fix unbounded enumeration.
- [ ] `v2/src/daemon/operator-notification.test.ts` — `pipeline awaiting-approval then terminal fires the sink once per transition` stays green (bounded derivation preserves actionable incidents inside the recency window).
- [ ] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 04.
