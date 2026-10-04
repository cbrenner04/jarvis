---
name: settle-superseded-pipeline-prs
---

# Terminal publication settles superseded preceding stage PRs

## Problem

Successful terminal `ready` or `merge` publication leaves earlier intent and plan PRs open even though the final PR carries their work.

## Behavior

After a single-lane `ready` or `merge` succeeds under `"close"`, comment `Superseded by #<n> (pipeline <id>, stage <stageId>)` on and close every open PR recorded by a preceding succeeded workflow stage (approval stages have no PR artifact); a PR closes only after its comment succeeds. Failures append durable `supersedeFailures: [{ prNumber, message }]` without clearing terminal success. `leave-draft`, failed, rejected, `"keep"`, and fan-out pipelines perform no supersede calls. Never deletes branches.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` drives a stubbed single-lane `ready` settlement proving comment-before-close on preceding PRs with no branch deletion; proves the exclusion set issues no calls; proves failures record `supersedeFailures`, continue candidates, and still derive `succeeded`; fails against the baseline.

## Documentation updates

- `v2/docs/pipeline-execution.md` — supersede ordering, exclusions, and nonfatal failure at terminal publication.
- `v2/docs/first-workflow-walkthrough.md` — inter-stage PRs are review surfaces; terminal settlement closes them under `"close"`.
- `v2/docs/daemon-host.md` — cross-link terminal supersede settlement (`pipeline-execution.md`).
- `v2/docs/state-store.md` — durable `supersedeFailures` (cross-link `pipeline-execution.md`).
- `v2/docs/v1-behaviors.md` — supersede settlement at terminal publication.

## Primary implementation surface

`v2/src/daemon/pipeline-execution.ts`

## Prerequisites

- Project pipeline resolution admits `projects.<key>.pipeline.supersede` as `close` or `keep`, defaults `close`, copies the resolved value onto the immutable admitted pipeline definition, and rejects malformed values during resolution with a message naming the config path.
