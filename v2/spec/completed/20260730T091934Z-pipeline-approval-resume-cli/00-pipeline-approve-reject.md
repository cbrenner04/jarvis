# Pipeline approve and reject

## Problem

Operators cannot admit approval decisions at a named gate from the CLI.

## Prerequisites

- [Pipeline operator CLI](../20260730T080335Z-pipeline-operator-cli/) registers `jarvis pipeline` with `start`, `list`, and `wait`.
- Daemon `pipeline_approve` and `pipeline_reject` admit stage-scoped decisions and surface named refusals (`v2/spec/20260730T081814Z-pipeline-daemon-approval-and-stage-resume/00-pipeline-approval-decisions.md`, `daemon-pipeline-approval.test.ts`).

## Decisions

- Add `jarvis pipeline approve <pipeline-id> <stage-id>` and `jarvis pipeline reject <pipeline-id> <stage-id>` under the existing `jarvis pipeline` family; rules out unscoped decisions or nesting under `jarvis run`.
- Require both positionals (non-empty after trim); missing, extra, or whitespace-only args are usage errors before daemon connect; rules out inferring the awaiting gate from `pipeline list`.
- Issue one `pipeline_approve` or `pipeline_reject` RPC with `{ pipelineId, stageId }`; rules out pipeline-ID-only settlement.
- Parse the daemon `result` envelope: `kind: "applied"` exits `0` with silent stdout; `kind: "refused"` prints the daemon `reason` verbatim on stderr (one line) and exits `1`; rules out treating refused decisions as success or masking store reasons.
- Unknown or malformed daemon result envelopes follow existing `pipeline wait` / `pipeline list` patterns (`invalid daemon response` on stderr, exit `1`); rules out a separate parse-failure vocabulary.
- Exit `0` on `applied` means the decision was durably admitted, not that the pipeline finished; pair with `pipeline wait` / `pipeline list` for progress; rules out implying terminal completion on success.
- Transport-level `RpcError` and connection failures follow existing `formatRpcError` / `formatConnectionError` patterns with exit `1`; rules out a separate approval error vocabulary.
- CLI-only; no daemon approval or store changes.

## Task checklist

- Extend `v2/src/commands/pipeline.ts` with approve/reject arg parsing and IPC wiring; add usage strings and command-tree entries.
- Extend `v2/src/commands/pipeline.test.ts` with applied vs refused outcomes (including `status_not_awaiting` and `invalid_decision`), usage errors, malformed-envelope handling, guard-inversion coverage, and help coverage for approve/reject.
- Add `jarvis pipeline approve` and `jarvis pipeline reject` dispatch-coverage operands in `v2/src/cli.test.ts`.
- Document approve/reject syntax, detached admission semantics, stdout silence on success, refusal stderr, usage errors, and RPC mapping in `v2/docs/write-behavior.md`; stage-ID discovery from `pipeline wait` / `list`, duplicate/stale decision handling, and approval-gate workflow in `v2/docs/operator-runbook.md`.

## Acceptance criteria

- [x] The approve/reject regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then proves valid commands send both IDs to `pipeline_approve` / `pipeline_reject` and exit `0` only on `kind: "applied"`.
- [x] The same regression file fails on baseline and then proves a refused `status_not_awaiting` decision (non-awaiting or mismatched stage) prints the named reason on stderr and exits non-zero.
- [x] The same regression file fails on baseline and then proves a refused duplicate or racing decision (for example `invalid_decision`) prints the named reason on stderr, exits non-zero, and emits no success stdout.
- [x] The same regression file fails on baseline and then proves missing, extra, or whitespace-only positionals are usage errors before daemon connect.
- [x] The same regression file fails on baseline and then proves an unknown or malformed daemon result envelope prints `invalid daemon response` on stderr and exits non-zero.
- [x] Inverting the applied-vs-refused exit guard makes `v2/src/commands/pipeline.test.ts` fail; negative cases prove refused outcomes are not reported as success.
- [x] `daemon-pipeline-approval.test.ts` and `pipeline-execution.test.ts` stay green (daemon-owned refusal and non-dispatch behavior unchanged by CLI wiring).
- [x] The help regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then lists `approve` and `reject` in shared `PIPELINE_USAGE`, `jarvis help pipeline`, and per-subcommand usage/help alongside existing pipeline commands.
- [x] `v2/src/cli.test.ts` dispatch-coverage includes `pipeline approve` and `pipeline reject` with minimally valid operands.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline approve` / `reject` syntax, detached admission (exit `0` means decision admitted not pipeline finished), silent success stdout, refusal stderr (`reason` verbatim), usage errors, malformed-envelope handling, and RPC mapping.
- `v2/docs/operator-runbook.md` — reading `stageId` from `pipeline wait` boundary JSON (`{kind:"awaiting-approval",stageId}`) and `pipeline list` stage rows; deciding with approve vs reject; duplicate/stale decisions (`invalid_decision`, `status_not_awaiting`) forwarded verbatim; pairing decisions with `pipeline wait` / `list`.
- `v2/docs/v1-behaviors.md` — additive v2 pipeline approve/reject CLI behavior.
