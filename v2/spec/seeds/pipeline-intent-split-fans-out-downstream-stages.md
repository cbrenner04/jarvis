---
name: pipeline-intent-split-fans-out-downstream-stages
---

# A splitting intent stage must fan out its downstream stages

## Problem

Splitting a seed into several ready-intents is the **normal** intent outcome, not an edge case —
it is what the intent step is for. But a pipeline stage carries exactly one artifact with one
`specPath`, so a split has nowhere to go:

- `intentHandoffSpecPath` (`v2/src/execution/intent-output.ts:71-83`) returns the concrete
  ready-intent **file** only when landing produced exactly one; two or more fall back to the
  ready-intents **directory**.
- `resolvePlanStage` then hands that directory to the plan builder, whose `validateReadyIntent`
  requires a file. The plan stage fails before any agent runs.

So a pipeline survives only the one-ready-intent case. Observed 2026-07-31 on the first configured
`full-review` run: the intent split the seed into two ready-intents
(`propagate-plan-draft-normalizer-reason`, `surface-contract-miss-reason-on-run-rows`), the
pipeline could not continue, and both had to be driven through the standalone CLI instead
(#2368). The single-file restriction was pinned as an explicit deferral in
`pipeline-stage-artifact-handoff-from-prior-worktree` — this seed is that deferral's first
consumer.

This is the gap that keeps pipelines from running unattended. It is not a rare shape: any seed
broad enough to be worth a pipeline is a seed the intent step is likely to split.

## Decisions

- A workflow stage may record **more than one** downstream input; the pipeline runs the remaining
  stages once per input — rules out picking one ready-intent, failing the split, or forcing the
  operator to re-enter each intent by hand.
- Fan-out is **per-branch sequencing from the splitting stage forward**: each downstream input gets
  its own ordered run of every subsequent stage, including approval gates, so one branch failing or
  being rejected does not settle the others — rules out one shared gate decision covering all
  branches, and rules out aborting the pipeline on the first branch failure.
- Durable stage records are keyed by `(stageId, branchKey)` where `branchKey` identifies the
  originating input; `pipeline list` and `pipeline wait` report each branch distinguishably, and
  `pipeline approve` / `reject` name the branch — rules out overwriting one stage row per stage
  and rules out an operator having to guess which branch a gate belongs to.
- The pipeline's terminal state is derived from all branches: `succeeded` only when every branch
  reached a terminal success; otherwise the aggregate names which branches failed — rules out
  reporting `succeeded` while a branch failed.
- Ordering across branches is **not** guaranteed to be parallel; running branches sequentially is
  an acceptable first implementation — rules out blocking this on a concurrency design. Pin
  concurrency when contention is observed.
- Out of scope: fan-out from a **plan** stage (a plan tree is already one implement input), and
  fan-in / cross-branch synchronization.

## Acceptance criteria

- [ ] An intent stage that lands N ready-intent files records N downstream inputs, each a concrete
      worktree-relative file path; a test with N=2 pins both paths and fails against the pre-fix
      code (which records the ready-intents directory).
- [ ] Resolving the stage after a splitting intent produces N plan-stage resolutions, one per
      ready-intent, each with its own `readyIntent` file; a test asserts both resolve `ok` and
      fails when the fan-out is collapsed to the first input.
- [ ] `pipeline list` reports each branch's stages distinguishably (branch key plus per-branch
      status), and `pipeline wait` surfaces an `awaiting-approval` boundary that names the
      branch; regressions cover a two-branch pipeline with one branch awaiting and one running.
- [ ] `pipeline approve` / `pipeline reject` applied to one branch's gate leaves the other
      branch's gate `awaiting`; a regression fails if a decision leaks across branches.
- [ ] With one branch failing and one succeeding, the pipeline settles a non-`succeeded` terminal
      state that names the failed branch, and the succeeding branch still reaches its terminal
      action; a regression covers both halves.
- [ ] An end-to-end integration case walks a two-ready-intent split through intent → plan →
      implement resolution on real stage worktrees, faking only agent dispatch/wait (same
      boundary as #2352 / #2363).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — stage artifacts may carry multiple
  downstream inputs; downstream stages run per branch; records are keyed by branch.
- `v2/docs/operator-runbook.md` § Pipeline approve and reject — gates are per branch; read the
  branch key from `pipeline wait` / `pipeline list`.
- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — what a splitting intent looks
  like to the operator.
- `v2/docs/v1-behaviors.md` — record the fan-out contract.

## Prerequisites

- Inter-stage handoff from the prior stage worktree (#2363)
- Single-file intent handoff `specPath` (#2359) and `intentHandoffSpecPath`'s multi-file fallback
- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` /
  `reject` / `resume`
