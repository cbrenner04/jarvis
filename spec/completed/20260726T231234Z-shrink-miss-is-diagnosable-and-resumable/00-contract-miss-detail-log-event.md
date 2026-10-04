# Write-loop `contract_miss` detail log event

## Problem

`contract_miss` commits a terminal boundary with only `outcomeKind` and
`failedContractId`. `invalid_token` and `missing_blocker` already append detail log
events with truncated agent text (`write-loop.ts`). Operators cannot see what the
agent returned on a shrink miss (or any write-loop miss) without re-invoking.

## Decisions

- Every write-loop `contract_miss` boundary appends a `contract_miss_detail` run-log
  event — rules out a shrink-only logging branch.
- **Wire contract:** `kind: "contract_miss_detail"`; fields `attemptId` (committed
  boundary attempt), `failedContractId`, and `responseText` (final agent response body
  used for contract evaluation at that boundary, same source as
  `missing_blocker_detail.responseText` — not `tokenText`). After an in-iteration
  reprompt, log the **final** post-reprompt body at the committed miss, not an earlier
  turn.
- Output is truncated via `truncateLogText` / `INVALID_TOKEN_LOG_MAX_CHARS` like
  `invalid_token_detail` — rules out unbounded log rows.
- `ContractMissDetailEvent` is a distinct member of the `LogEvent` union in
  `log-stream.ts` — rules out overloading `missing_blocker_detail` or
  `invocation_failure` detail blobs.
- Deferred to first consumer: TUI/log-follow rendering for `contract_miss_detail` —
  pin when an operator surface needs it beyond raw `run log`.

## Task checklist

- Append `contract_miss_detail` at the existing terminal-boundary log site in
  `write-loop.ts`.
- Add `ContractMissDetailEvent` to `log-stream.ts` and the `LogEvent` union.
- Add write-loop and workflow-runner tests (shrink run id) for emission and
  truncation.

## Acceptance criteria

- [x] `log-stream.test.ts` (or an equivalent typed fixture beside `log-stream.ts`)
      asserts `contract_miss_detail` is assignable on `LogEvent` with
      `attemptId`, `failedContractId`, and `responseText`; it fails against the
      pre-fix code.
- [x] `write-loop.test.ts` `contract_miss appends contract_miss_detail to the observability log` drives a `contract_miss` boundary and asserts a `contract_miss_detail` event with `failedContractId` and `responseText` matching the failing invocation output; it fails against the pre-fix code.
- [x] `workflow-runner.test.ts` `shrink contract_miss appends contract_miss_detail on the hidden shrink run` completes implement then injects shrink `contract_miss`, asserting the detail event is on `implement~shrink`, not the implement row; it fails against the pre-fix code.
- [x] `write-loop.test.ts` `contract_miss_detail truncates long invocation output like invalid_token_detail` asserts truncation matches `INVALID_TOKEN_LOG_MAX_CHARS` ellipsis behavior; it fails against the pre-fix code.
- [x] `write-loop.test.ts` `complete, blocked, contract_miss, and budget-exhausted omit failure detail` stays green (`WriteLoopResult` / `failureKind` shape unchanged by this subspec; it does not assert absence of `contract_miss_detail`).

## Documentation updates

- `v2/docs/write-behavior.md` — document `contract_miss_detail` alongside other
  terminal detail events.
- `v2/docs/workflow-runner.md` — note shrink misses expose output via
  `contract_miss_detail` on the `~shrink` run.
- `v2/docs/v1-behaviors.md` — v2 write-loop `contract_miss` now logs truncated
  invocation output.
