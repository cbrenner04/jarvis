---
name: expose-pipeline-stage-recovery-command
---

# Expose a Pipeline Stage Recovery Command

## Prerequisites

- A populated operator-edited plan stage can be revalidated and continued through review and publication without plan drafting, preserves invalid staged bytes, consumes the ready-intent only on success, and excludes staging sidecars from commits.
- The daemon can recover the current blocked plan stage for one named pipeline `branchKey`, re-settle and advance only that branch on success, preserve sibling rows and gates, and return clear refusals without automatic recovery.

## Surface

CLI.

## Problem

- The operator has no deliberate command that distinguishes in-place recovery of an edited blocked stage from ordinary pipeline replay.

## Behavior

- A pipeline operator command accepts a pipeline and branch target, requests daemon-owned blocked-stage recovery, reports admission or refusal consistently with the daemon contract, and exposes a clear recovery failure through the existing pipeline observation path when staged validation still fails.

## Decisions

- Keep recovery distinct from ordinary `pipeline resume`; rules out making a replay verb silently change meaning for `resumable: false` stages.
- Require an explicit branch target; rules out whole-pipeline recovery that could disturb sibling landing gates.
- Deferred to first consumer: recovery command spelling and positional grammar — pin when the CLI plan consumes the daemon recovery contract.
- Deferred to first consumer: synchronous settlement versus detached admission — pin when the CLI plan consumes the daemon recovery contract.

## Required verification

- CLI tests pin argument validation, the branch-scoped daemon request, and admission/refusal reporting selected by the consumer contract.
- Dispatch and help tests expose the deliberate recovery operation without changing ordinary pipeline resume grammar or behavior.

## Documentation updates

- `v2/docs/operator-runbook.md` — locate and edit the blocked branch worktree's `.jarvis-plan-stage/`, invoke recovery for that branch, and distinguish recovery from ordinary branch-scoped resume and approval decisions.
- `v2/docs/v1-behaviors.md` — additive operator command for branch-scoped blocked-stage recovery.
