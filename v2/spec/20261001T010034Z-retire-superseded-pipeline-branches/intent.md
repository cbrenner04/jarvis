---
name: retire-superseded-pipeline-branches
---

# Cleanup retires branches proven superseded by a merged successor PR

## Problem

`jarvis cleanup` refuses branches whose PRs were closed without merge even when terminal publication superseded them with a merged final PR.

## Behavior

Cleanup accepts a closed PR as retirement authority only when it owns the candidate branch head, carries the exact supersede comment, and the referenced same-repo PR is merged. Applies to materialized-worktree retirement and local-ref pruning. Every broken proof component stays ineligible. Existing live-run, daemon, and base-branch guards remain. Local-only; never remote deletion.

## Acceptance criteria

- [ ] `cleanup.test.ts` proves retirement of a materialized superseded branch and pruning of an eligible head-only branch under full proof; proves a merely closed PR and each broken proof component remain ineligible; fails against the baseline.
- [ ] `cleanup.test.ts` `merged plan worktree with landed criteria-only dirt retires safely`, `merged local head candidate requires matching merged PR head`, and `default merged-worktree retirement prunes origin tracking ref` stay green.

## Documentation updates

- `v2/docs/operator-runbook.md` — superseded-branch retirement authority and refusals.
- `v2/docs/v1-behaviors.md` — cleanup authority for proven-superseded branches.

## Primary implementation surface

`v2/src/commands/cleanup.ts`

## Prerequisites

- Project pipeline resolution admits `projects.<key>.pipeline.supersede` as `close` or `keep`, defaults `close`, copies the resolved value onto the immutable admitted pipeline definition, and rejects malformed values during resolution with a message naming the config path.
- After successful single-lane `ready` or `merge` terminal publication under `close`, pipeline execution comments `Superseded by #<n> (pipeline <id>, stage <stageId>)` on each open PR from a preceding succeeded workflow stage (approval stages have no PR artifact), closes each PR only after its comment succeeds, records nonfatal failures in durable `supersedeFailures`, performs no supersede for `leave-draft`, failed, rejected, `keep`, or fan-out pipelines, and never deletes branches.
