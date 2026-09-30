# Project review-feedback item traceability in operator summaries

## Problem

Terminal `loop_finished` rows can carry review-feedback item id arrays after subspec `00`, but `jarvis run log`, `jarvis run list`, and `jarvis run wait` do not surface them, so successful `complete`/`no-work` settlements still look silent when some captured items were skipped.

## Prerequisites

- Subspec `00-review-feedback-item-reconciliation.md` (terminal `loop_finished` carries the three id arrays).

## Decisions

- Operator summary text lists non-empty buckets as labeled lines (`addressed:`, `declined:`, `unaddressed:`) with comma-separated ids in capture-stable order — rules out prose paraphrase without ids or collapsing declined into unaddressed.
- `jarvis run log` JSONL for terminal `loop_finished` exposes the three id array fields verbatim when present — rules out a log-only prose field that omits machine-readable ids.
- `jarvis run wait` stdout JSON and `jarvis run list` rows for the settled review-feedback run expose the same three optional array fields, read from the terminal `loop_finished` record (not `composeRunOperatorError`, which stays absent on successful `complete`/`no-work`) — rules out requiring a synthetic operator error reason just to reuse the failure `message` column.
- `jarvis run list` appends three JSON-encoded columns (`reviewFeedbackAddressedItemIds`, `reviewFeedbackDeclinedItemIds`, `reviewFeedbackUnaddressedItemIds`) after the existing trailing columns when any bucket is non-empty; all three columns are present in that row and an empty bucket renders as `[]` — rules out dropping a column for an empty bucket or blank cells that shift column indices.
- When all three arrays are empty, wait/list omit the fields and log omits them — rules out placeholder empty arrays in every summary.
- TUI run monitor formatting is out of scope — rules out blocking this spec on TUI parity.

## Tasks

- Thread terminal `loop_finished` review-feedback item fields through daemon `wait` / `list` projection into `WaitRunCompletionResult` and `DaemonListRunRow` (wire types in `v2/src/daemon/daemon.ts` and `daemon-wire.ts`).
- Extend `buildWaitPayload` in `v2/src/cli/run-completion.ts` to pass the arrays through when present; extend `formatListRunRow` or an adjacent list section so operators see the ids without reading raw JSONL.
- Add/adjust tests in `daemon-wait-run-completion.test.ts` and `run.test.ts` (or the existing review-feedback executeWorkflow harness) asserting log + wait/list visibility for the subset-addressed fixture.

## Acceptance criteria

- [ ] `review-feedback-write-run.test.ts` test `lists addressed, declined, and unaddressed capture ids in run log and wait output when the sidecar clears a subset` extends the subspec `00` fixture with a declined sidecar line and asserts terminal `jarvis run log` JSONL and wait JSON include the three id array fields with the expected ids; fails against the pre-fix operator projection.
- [ ] `review-feedback-write-run.test.ts` test `lists addressed, declined, and unaddressed capture ids in run list when the sidecar clears a subset` asserts the settled run's list row includes all three trailing JSON columns with `[]` for empty buckets and the expected ids elsewhere; fails against the pre-fix list projection.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — in the `jarvis run workflow review-feedback` section, how to read addressed, declined, and unaddressed capture ids (`threadId` / `commentId`) from `run log`, `run list`, and `run wait` after settlement; ids are the operator-facing item identifier.
- `v2/docs/v1-behaviors.md` — extend the existing review-feedback `[v2 additive]` entries to note addressed/declined/unaddressed item traceability on settled review-feedback runs (preset lane admission, PR-thread capture, sidecar contract) versus v1 worktree-name `review-feedback` without item-level settlement reporting.
