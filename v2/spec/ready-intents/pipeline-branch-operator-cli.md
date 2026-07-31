---
name: pipeline-branch-operator-cli
---

# Pipeline CLI names branches for observation and gate decisions

## Problem

`pipeline list`, `wait`, `approve`, and `reject` address stages by `stageId` only. After an intent
split the operator cannot tell which branch is awaiting or target a gate decision.

## Decisions

- `pipeline list` reports `branchKey` and per-branch stage status for every branch row — rules out a single status line per `stageId`.
- `pipeline wait` surfaces `awaiting-approval` with the branch key of the blocking gate — rules out an anonymous approval boundary.
- `pipeline approve` and `pipeline reject` require a branch key and apply only to that branch's gate — rules out a decision leaking across branches.
- `derivePipelineBoundary` and `pipeline_list` projection carry `branchKey` per branch — rules out CLI-only framing without daemon observation updates.
- CLI remains a thin daemon RPC wrapper; fan-out execution logic stays in the daemon — rules out reimplementing branch scheduling in the CLI.

## Acceptance criteria

- [ ] `pipeline.test.ts` — two-branch pipeline: `pipeline list` shows distinguishable branch keys and per-branch statuses; flattening to one row per `stageId` makes the test fail.
- [ ] `daemon-pipeline-observation.test.ts` — two-branch pipeline: `pipeline_list` projection and `derivePipelineBoundary` `awaiting-approval` name the branch key; omitting `branchKey` in projection makes the test fail.
- [ ] `pipeline.test.ts` — with one branch `awaiting` and one `running`, `pipeline wait` reports an `awaiting-approval` boundary that names the awaiting branch; omitting the branch key makes the test fail.
- [ ] `pipeline.test.ts` — `pipeline approve` / `pipeline reject` on one branch leaves the other branch's gate `awaiting`; cross-branch leakage makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `pipeline list` / `wait` / `approve` / `reject` syntax and RPC envelopes name `branchKey`.
- `v2/docs/operator-runbook.md` § Pipeline approve and reject — gates are per branch; read the branch key from `pipeline wait` / `pipeline list`.
- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — what a splitting intent looks like to the operator.
- `v2/docs/v1-behaviors.md` — record branch-keyed pipeline CLI contract.

## Prerequisites

- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` / `reject` / `resume` exist.
- Inter-stage handoff resolves chained inputs from the prior entry-run worktree.
- Intent completion records a concrete ready-intent file on the entry run and stage artifact when landing produces exactly one ready-intent file; the ready-intents directory when landing produces more than one.
- Pipeline stage rows are keyed by `(stageId, branchKey)` and stage artifacts may carry multiple downstream inputs.
- Multi-file intent landing records one downstream input per landed ready-intent file on the entry run and stage artifact.
- Pipeline execution fans out downstream stages per ready-intent branch, resolves plan per input, settles terminal state across branches, and scopes approval gates per branch.
