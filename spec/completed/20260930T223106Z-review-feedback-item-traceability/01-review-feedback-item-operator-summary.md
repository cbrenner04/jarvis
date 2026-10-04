# Project review-feedback item traceability in operator summaries

## Problem

Terminal `loop_finished` rows can carry review-feedback item id arrays after subspec `00`, but `jarvis run log`, `jarvis run list`, and `jarvis run wait` do not surface them, so successful `complete`/`no-work` settlements still look silent when some captured items were skipped.

## Prerequisites

- Subspec `00-review-feedback-item-reconciliation.md` (terminal `loop_finished` carries the three id arrays).

## Decisions

- `jarvis run log` JSONL for terminal `loop_finished` exposes the three id array fields verbatim when present — rules out a log-only prose field that omits machine-readable ids.
- `jarvis run wait` stdout JSON and `jarvis run list` rows for the settled review-feedback run expose the same three optional array fields, read from the terminal `loop_finished` record (not `composeRunOperatorError`, which stays absent on successful `complete`/`no-work`) — rules out requiring a synthetic operator error reason just to reuse the failure `message` column.
- `jarvis run list` appends three JSON-encoded columns (`reviewFeedbackAddressedItemIds`, `reviewFeedbackDeclinedItemIds`, `reviewFeedbackUnaddressedItemIds`) after the existing trailing columns when any bucket is non-empty; all three columns are present in that row and an empty bucket renders as `[]` — rules out dropping a column for an empty bucket or blank cells that shift column indices.
- When all three arrays are empty, wait/list omit the fields; `run log` stays verbatim — rules out placeholder empty arrays in every summary.
- TUI run monitor formatting is out of scope — rules out blocking this spec on TUI parity.

## Tasks

- Thread terminal `loop_finished` review-feedback item fields through daemon `wait` / `list` projection into `WaitRunCompletionResult` and `DaemonListRunRow` (wire types in `v2/src/daemon/daemon.ts` and `daemon-wire.ts`).
- Extend `buildWaitPayload` in `v2/src/cli/run-completion.ts` to pass the arrays through when present; extend `formatListRunRow` or an adjacent list section so operators see the ids without reading raw JSONL.
- Add tests in `v2/src/daemon/daemon-wait-run-completion.test.ts` (wait + list projection from a seeded terminal `loop_finished`) and `v2/src/commands/run.test.ts` (list columns).

## Acceptance criteria

- [x] `daemon-wait-run-completion.test.ts` test `wait and list project review-feedback item id arrays from the terminal loop_finished` seeds a terminal `loop_finished` carrying one addressed, one declined, and one unaddressed id and asserts wait JSON and the `DaemonListRunRow` carry all three arrays; a second case with three empty arrays asserts the fields are absent.
- [x] `run.test.ts` test `run list appends review-feedback item id columns` asserts a row with ids in one bucket renders all three trailing JSON columns, `[]` for empty buckets.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — in the `jarvis run workflow review-feedback` section, how to read addressed, declined, and unaddressed capture ids (`threadId` / `commentId`) from `run log`, `run list`, and `run wait` after settlement; ids are the operator-facing item identifier.
- `v2/docs/v1-behaviors.md` — extend the existing review-feedback `[v2 additive]` entries to note addressed/declined/unaddressed item traceability on settled review-feedback runs (preset lane admission, PR-thread capture, sidecar contract) versus v1 worktree-name `review-feedback` without item-level settlement reporting.
