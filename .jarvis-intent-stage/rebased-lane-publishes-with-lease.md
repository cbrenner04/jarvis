---
name: rebased-lane-publishes-with-lease
---

# A continued lane that was rebased publishes with a lease-forced push

Unsplit rationale: the fix is one publication-push behavior in the completion publisher (plus threading the "this run rebased" fact and observed remote tip into its input), well under one reviewable PR.

## Primary implementation surface

- `v2/src/execution/completion-publisher.ts`

## Problem

# 4014 rebases a non-descendant lane on incomplete re-dispatch, rewriting its SHAs. `completion-publisher.ts:136` pushes `HEAD:refs/heads/<branch>` without a lease, so an already-pushed lane (open-PR case) is rejected non-fast-forward; `publication-retry.ts:45` classifies that permanent. The run spends a full implement then dies at publication with commits only local. No test covers push-after-rebase

## Decisions

- The completion push uses `--force-with-lease=refs/heads/<branch>:<observed remote tip>` when, and only when, this run rebased the lane; rules out both a blanket force push and a lane that can never publish after a rebase.
- A lease rejection stays a permanent publication failure naming the branch and expected-versus-actual remote SHA; never escalates to `--force`.
- A non-rebased lane keeps the current non-force push unchanged.

## Acceptance criteria

- [ ] A `completion-publisher` test proves a rebased lane whose branch was already pushed publishes successfully with a lease against the tip the run observed; it fails against the current unconditional non-force push.
- [ ] A test proves a non-rebased lane still pushes without any force flag.
- [ ] A test proves a lease rejection settles a permanent publication failure naming the branch and expected-versus-actual remote SHA, with no retry and no `--force` escalation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — lease-forced publication push for a rebased continued lane and its rejection shape.
- `v2/docs/operator-runbook.md` — what a lease rejection means and why re-running is not the recovery.
- `v2/docs/v1-behaviors.md` — publication push behavior for rebased lanes.

## Prerequisites
