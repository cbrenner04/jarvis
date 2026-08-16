---
name: settle-superseded-pipeline-prs
---

# Close superseded stage PRs after terminal publication

## Prerequisites

- Project-pipeline resolution admits an immutable `"close"` or `"keep"` supersede policy, defaulting to `"close"`.
- Terminal publication settles single-lane `ready` and `merge` actions only after every authored stage succeeds and retains the final workflow stage's PR evidence.

## Problem

Successful terminal publication leaves preceding intent and plan PRs open even though the final PR carries their work.

## Decisions

- After a single-lane `ready` or `merge` action succeeds under `supersede: "close"`, comment on and close every open PR recorded by a preceding succeeded workflow stage; rules out merging review-only PRs.
- The comment is exactly `Superseded by #<n> (pipeline <id>, stage <stageId>)`, where `<n>` and `<stageId>` identify the successful final-stage PR; rules out cleanup guessing lineage from branch names.
- A PR closes only after its comment succeeds; rules out an uncommented close that cleanup cannot verify.
- Supersede attempts continue after an individual comment or close failure; rules out one stale PR blocking hygiene for later candidates.
- `leave-draft`, failed, rejected, `supersede: "keep"`, and fan-out pipelines perform no supersede calls; rules out destroying recovery evidence or defining multi-branch publication here.
- Supersede settlement never deletes local or remote branches; rules out a second branch-teardown owner beside `jarvis cleanup`.
- Comment or close failures append durable `supersedeFailures: [{ prNumber, message }]` detail without clearing terminal-publication success or changing derived `succeeded`; rules out regressing a landed final PR over hygiene.
- Deferred to first consumer: retry and idempotency after process death between comment and close — pin when pipeline recovery consumes partial supersede settlement.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` fails against the baseline, then drives a successful single-lane `ready` settlement through a stub PR client and proves preceding intent and plan PRs receive the exact comment before close while no branch deletion is requested.
- [ ] `pipeline-execution.test.ts` proves `leave-draft`, failed, rejected, `supersede: "keep"`, and fan-out pipelines issue no supersede comment or close.
- [ ] `pipeline-execution.test.ts` records comment and close errors in `supersedeFailures`, continues remaining candidates, and still derives the pipeline as `succeeded`.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — inter-stage PRs are review surfaces; do not merge them; successful terminal settlement closes them.
- `v2/docs/daemon-host.md` — supersede ordering, exclusions, nonfatal failure detail, and derived-state contract.
- `v2/docs/state-store.md` — durable `supersedeFailures` detail.
- `v2/docs/v1-behaviors.md` — v2 terminal supersede settlement.
