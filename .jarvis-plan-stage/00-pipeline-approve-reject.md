# Pipeline approve and reject

## Problem

Operators cannot admit approval decisions at a named gate from the CLI.

## Prerequisites

- [Pipeline operator CLI](../20260730T080335Z-pipeline-operator-cli/) registers `jarvis pipeline` with `start`, `list`, and `wait`.
- Daemon `pipeline_approve` and `pipeline_reject` admit stage-scoped decisions and surface named refusals (`v2/spec/20260730T081814Z-pipeline-daemon-approval-and-stage-resume/00-pipeline-approval-decisions.md`, `daemon-pipeline-approval.test.ts`).

## Decisions

- Add `jarvis pipeline approve <pipeline-id> <stage-id>` and `jarvis pipeline reject <pipeline-id> <stage-id>` under the existing `jarvis pipeline` family; rules out unscoped decisions or nesting under `jarvis run`.
- Require both positionals (non-empty after trim); missing or extra args are usage errors before daemon connect; rules out inferring the awaiting gate from `pipeline list`.
- Issue one `pipeline_approve` or `pipeline_reject` RPC with `{ pipelineId, stageId }`; rules out pipeline-ID-only settlement.
- Parse the daemon `result` envelope: `kind: "applied"` exits `0` with silent stdout; `kind: "refused"` prints the daemon `reason` verbatim on stderr (one line) and exits `1`; rules out treating refused decisions as success or masking store reasons.
- Transport-level `RpcError` and connection failures follow existing `formatRpcError` / `formatConnectionError` patterns with exit `1`; rules out a separate approval error vocabulary.
- CLI-only; no daemon approval or store changes.

## Task checklist

- Extend `v2/src/commands/pipeline.ts` with approve/reject arg parsing and IPC wiring; add usage strings and command-tree entries.
- Extend `v2/src/commands/pipeline.test.ts` with applied vs refused outcomes, usage errors, guard-inversion coverage, and a case proving a refused non-awaiting decision does not advance later stages (via daemon stub or list snapshot).
- Add `jarvis pipeline approve` and `jarvis pipeline reject` dispatch-coverage operands in `v2/src/cli.test.ts`.
- Document approve/reject syntax, stdout silence on success, refusal stderr, and usage errors in `v2/docs/write-behavior.md` and operator approval-gate workflow in `v2/docs/operator-runbook.md`.

## Acceptance criteria

- [ ] The approve/reject regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then proves valid commands send both IDs to `pipeline_approve` / `pipeline_reject` and exit `0` only on `kind: "applied"`.
- [ ] The same regression file fails on baseline and then proves a refused decision (for example `status_not_awaiting` on a non-awaiting or mismatched stage) prints the named reason on stderr, exits non-zero, and does not dispatch a later stage.
- [ ] Inverting the applied-vs-refused exit guard makes `v2/src/commands/pipeline.test.ts` fail; negative cases prove refused outcomes are not reported as success.
- [ ] `v2/src/cli.test.ts` dispatch-coverage includes `pipeline approve` and `pipeline reject` with minimally valid operands.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline approve` / `reject` syntax, silent success stdout, refusal stderr (`reason` verbatim), usage errors, and RPC mapping.
- `v2/docs/operator-runbook.md` — reading `awaiting-approval` from `pipeline wait` / `list`, choosing the `stageId`, and deciding with approve vs reject.
- `v2/docs/v1-behaviors.md` — additive v2 pipeline approve/reject CLI behavior.
