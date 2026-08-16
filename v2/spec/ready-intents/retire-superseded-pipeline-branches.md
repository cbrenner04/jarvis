---
name: retire-superseded-pipeline-branches
---

# Retire branches proven superseded by a merged PR

## Prerequisites

- Project-pipeline resolution admits an immutable `"close"` or `"keep"` supersede policy, defaulting to `"close"`.
- Successful single-lane `ready` or `merge` settlement under `supersede: "close"` comments on and closes preceding stage PRs with `Superseded by #<n> (pipeline <id>, stage <stageId>)`, leaves branches intact, and keeps hygiene failures nonfatal.

## Problem

`jarvis cleanup` refuses a superseded intent or plan branch because its own PR is closed rather than merged.

## Decisions

- Cleanup accepts a closed PR as retirement authority only when it owns the candidate branch head, carries the exact supersede comment, and the referenced same-repository PR is merged; rules out trusting branch names or closed state alone.
- The authority applies to materialized-worktree retirement and worktree-independent local-ref pruning; rules out leaving one cleanup path unable to retire superseded branches.
- A merely closed PR, malformed or missing supersede comment, head mismatch, missing referenced PR, or non-merged referenced PR remains ineligible; rules out weakening cleanup's fail-closed proof.
- Existing live-run, daemon-liveness, checked-out/current/base-branch, and apply-time revalidation guards remain; rules out supersede evidence bypassing non-PR safety gates.
- Bulk cleanup remains local-only and never deletes the remote branch; rules out expanding terminal settlement into remote teardown.

## Acceptance criteria

- [ ] `cleanup.test.ts` fails against the baseline, then proves cleanup retires a materialized superseded branch and prunes an eligible head-only superseded branch when the closed PR owns the head, carries the exact comment, and its referenced PR is merged.
- [ ] `cleanup.test.ts` proves a merely closed PR and each broken proof component remain ineligible without deleting local refs.
- [ ] Existing merged-PR retirement and cleanup safety tests stay green.

## Documentation updates

- `v2/docs/operator-runbook.md` — superseded-PR retirement authority, refusal cases, and local-only branch teardown.
- `v2/docs/v1-behaviors.md` — v2 cleanup authority for superseded pipeline branches.
