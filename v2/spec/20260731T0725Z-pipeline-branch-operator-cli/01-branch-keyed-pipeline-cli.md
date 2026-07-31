# Branch-keyed pipeline CLI

## Problem

`jarvis pipeline list`, `wait`, `approve`, and `reject` address stages by `stageId` only. After an intent split the operator cannot read the blocking branch from CLI output or target a gate decision to one branch.

## Surface

Primary: `v2/src/commands/pipeline.ts`, `v2/src/cli/usage.ts`. In-scope: `pipeline.test.ts`, `cli.test.ts` dispatch operands, help strings.

## Prerequisites

- Subspec 00 landed: `pipeline_list` and `pipeline_wait` project `branchKey` per branch row and name `awaiting-approval` boundaries with `branchKey`.
- Daemon `pipeline_approve` / `pipeline_reject` resolve gates by `(pipelineId, stageId, branchKey)` and refuse omitted `branchKey` when multiple branch rows exist (`v2/spec/20260731T030451Z-pipeline-intent-split-fan-out-execution/01-execute-branch-fan-out.md`).

## Decisions

- CLI remains a thin daemon RPC wrapper — rules out reimplementing branch scheduling in the CLI.
- `jarvis pipeline approve <pipeline-id> <stage-id> <branch-key>` and `jarvis pipeline reject <pipeline-id> <stage-id> <branch-key>` — three required positionals (non-empty after trim); usage error before daemon connect when missing, extra, or whitespace-only — rules out `stageId`-only decisions that leak across branches.
- Issue one `pipeline_approve` / `pipeline_reject` RPC with `{ pipelineId, stageId, branchKey }` — rules out omitting `branchKey` at the CLI boundary.
- `jarvis pipeline list` continues one `pipeline_list` RPC with JSON passthrough; stage rows mirror daemon `branchKey` projection — rules out CLI-side collapsing.
- `jarvis pipeline wait` prints `{ kind: "awaiting-approval", stageId, branchKey }` when the daemon names a branch gate; `parsePipelineWaitBoundary` rejects `awaiting-approval` without `branchKey` — rules out anonymous approval stdout.
- Attached `pipeline start` keeps looping on any `awaiting-approval` boundary without printing boundary JSON — rules out changing detached/attached admission semantics in this slice.
- Single-default-branch pipelines use `branchKey: "default"` in operator examples and RPC params — rules out inventing alternate default labels.

## Task checklist

- Extend `parsePipelineDecisionArgs`, `parsePipelineWaitBoundary`, approve/reject wiring, and usage strings in `pipeline.ts` / `usage.ts`.
- Add two-branch list, wait, and approve/reject isolation coverage in `pipeline.test.ts`; update existing fixtures for `branchKey: "default"` and three-position approve/reject operands.
- Update `pipeline approve` / `pipeline reject` dispatch operands in `cli.test.ts`.
- Document branch-keyed syntax and operator flow in `write-behavior.md`, `operator-runbook.md` § Pipeline approve and reject, `first-workflow-walkthrough.md` § Configured pipeline, and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline.test.ts` — two-branch pipeline: `pipeline list` stdout shows distinguishable `branchKey` values and per-branch statuses; flattening to one row per `stageId` makes the test fail.
- [ ] `pipeline.test.ts` — with one branch `awaiting` and one `running`, `pipeline wait` prints an `awaiting-approval` boundary that names the awaiting `branchKey`; omitting `branchKey` makes the test fail.
- [ ] `pipeline.test.ts` — `pipeline approve` / `pipeline reject` on one branch sends `branchKey` in the RPC and leaves the other branch's gate `awaiting`; cross-branch leakage makes the test fail.
- [ ] `pipeline.test.ts` — inverting the approve/reject `branchKey` RPC guard or the applied-vs-refused exit guard makes the branch-isolation regression fail; negative cases prove the untouched branch stays `awaiting`.
- [ ] `pipeline.test.ts` — missing, extra, or whitespace-only approve/reject positionals (including omitted `branch-key`) are usage errors before daemon connect.
- [ ] `cli.test.ts` — dispatch-coverage operands for `pipeline approve` and `pipeline reject` include a `branch-key` third positional.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `pipeline list` / `wait` / `approve` / `reject` syntax and RPC envelopes name `branchKey`.
- `v2/docs/operator-runbook.md` § Pipeline approve and reject — gates are per branch; read `branchKey` from `pipeline wait` / `pipeline list`.
- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — what a splitting intent looks like to the operator (`branchKey` per branch in list/wait; approve/reject operands).
- `v2/docs/v1-behaviors.md` — record branch-keyed pipeline CLI contract.
