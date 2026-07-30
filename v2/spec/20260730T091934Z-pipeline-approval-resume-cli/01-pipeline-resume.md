# Pipeline resume

## Problem

Operators cannot re-enter a failed or awaiting pipeline from the CLI without starting a new one.

## Prerequisites

- [00 - Pipeline approve and reject](./00-pipeline-approve-reject.md) lands first on the shared `pipeline.ts` / `pipeline.test.ts` / `cli.test.ts` / docs seam.
- [Pipeline operator CLI](../20260730T080335Z-pipeline-operator-cli/) registers `jarvis pipeline`.
- Daemon `pipeline_resume` is the sole stage-scoped resume entry point, preserves predecessor `workflowInvocationId`s on failed reopen, and names terminal refusals (`v2/spec/20260730T081814Z-pipeline-daemon-approval-and-stage-resume/02-pipeline-stage-scoped-resume.md`, `daemon-pipeline-resume.test.ts`, `pipeline-execution.test.ts`).

## Decisions

- Add `jarvis pipeline resume <pipeline-id>` under `jarvis pipeline`; rules out translating resume into `pipeline start` or `jarvis run resume`.
- Require one non-empty positional pipeline ID; missing, extra, or whitespace-only args are usage errors before daemon connect.
- Issue one `pipeline_resume` RPC with `{ pipelineId }`; rules out client-side reopen or continuation logic.
- Parse the daemon `result` envelope: `kind: "resumed"` exits `0` with silent stdout; `kind: "refused"` prints the daemon `reason` verbatim on stderr (one line) and exits `1`; rules out success on `pipeline_terminal_succeeded`, `pipeline_terminal_rejected`, or other refusals.
- Unknown or malformed daemon result envelopes follow existing `pipeline wait` / `pipeline list` patterns (`invalid daemon response` on stderr, exit `1`); rules out a separate parse-failure vocabulary.
- Resume returns after daemon admission (detached continuation); rules out client-side `pipeline_wait` or implying the pipeline finished.
- Transport-level `RpcError` and connection failures follow existing CLI IPC error patterns with exit `1`.
- CLI-only; no daemon resume behavior changes.

## Task checklist

- Implement `pipeline resume` in `v2/src/commands/pipeline.ts` with usage/help and command-tree registration.
- Extend `v2/src/commands/pipeline.test.ts` with resumed vs refused outcomes (failed, awaiting-approval, `pipeline_terminal_succeeded`, `pipeline_terminal_rejected`), usage errors, malformed-envelope handling, guard-inversion coverage, and help coverage for resume.
- Add `jarvis pipeline resume` dispatch-coverage operands in `v2/src/cli.test.ts`.
- Document resume syntax, detached admission semantics, refusal stderr, `jarvis pipeline resume` vs `jarvis run resume`, and operator replay expectations in `v2/docs/write-behavior.md` and `v2/docs/operator-runbook.md`.

## Acceptance criteria

- [ ] The resume regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then proves `pipeline resume` issues `pipeline_resume` with the pipeline ID and exits `0` only on `kind: "resumed"` for a failed pipeline.
- [ ] The same regression file fails on baseline and then proves `pipeline resume` on an `awaiting-approval` pipeline issues `pipeline_resume`, exits `0` on `kind: "resumed"`, and emits silent stdout.
- [ ] The same regression file fails on baseline and then proves resume on a completed pipeline prints `pipeline_terminal_succeeded` on stderr with non-zero exit, and resume on a rejected pipeline prints `pipeline_terminal_rejected` with non-zero exit.
- [ ] The same regression file fails on baseline and then proves missing, extra, or whitespace-only positionals are usage errors before daemon connect.
- [ ] The same regression file fails on baseline and then proves an unknown or malformed daemon result envelope prints `invalid daemon response` on stderr and exits non-zero.
- [ ] Inverting the resumed-vs-refused exit guard makes `v2/src/commands/pipeline.test.ts` fail; negative cases prove terminal and other refusals are not reported as success.
- [ ] `pipeline-execution.test.ts` and `daemon-pipeline-resume.test.ts` stay green (daemon-owned invocation-ID preservation unchanged by CLI wiring).
- [ ] The help regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then lists `resume` in shared `PIPELINE_USAGE`, `jarvis help pipeline`, and per-subcommand usage/help alongside `start`, `list`, `wait`, `approve`, and `reject`.
- [ ] `v2/src/cli.test.ts` dispatch-coverage includes `pipeline resume` with minimally valid operands.

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline resume` syntax, silent success stdout, detached admission (exit `0` means resumed not finished), refusal stderr (`reason` verbatim), malformed-envelope handling, and usage errors; contrast with `jarvis run resume`.
- `v2/docs/operator-runbook.md` — when to `pipeline resume` vs `pipeline start` vs `jarvis run resume`; what failed and awaiting resume replays; pairing resume with `pipeline wait`.
- `v2/docs/v1-behaviors.md` — additive v2 pipeline resume CLI behavior.
