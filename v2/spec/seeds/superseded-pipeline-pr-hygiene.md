---
name: superseded-pipeline-pr-hygiene
---

# Superseded stage PRs close after terminal publication, and cleanup retires their branches

Merges the former `configure-pipeline-supersede-policy`, `settle-superseded-pipeline-prs`, and `retire-superseded-pipeline-branches` seeds (2026-09-05 compaction) — one root cause, three slices in dependency order. All three were demoted 2026-08-29: terminal publication is reworked by [[pipeline-settlement-derives-from-run-rows]]; **re-scope this family against the post-restructure settlement seam before planning.**

## Problem

Successful terminal publication leaves preceding intent and plan PRs open even though the final PR carries their work, and `jarvis cleanup` then refuses their branches because the PRs are closed rather than merged.

## Slice 1 — supersede policy admission

- `projects.<key>.pipeline.supersede` accepts `"close"` or `"keep"`, defaults `"close"`; resolution copies the policy onto the immutable admitted definition; malformed values fail resolution naming the config path.
- AC: `project-pipeline-resolution.test.ts` proves default/explicit isolation on admitted definitions and rejects malformed values before admission; fails against the baseline.

## Slice 2 — settle superseded PRs at terminal publication

- After a single-lane `ready`/`merge` succeeds under `"close"`, comment `Superseded by #<n> (pipeline <id>, stage <stageId>)` on and close every open PR recorded by a preceding succeeded stage; a PR closes only after its comment succeeds; failures append durable `supersedeFailures: [{ prNumber, message }]` without clearing terminal success; `leave-draft`, failed, rejected, `"keep"`, and fan-out pipelines perform no supersede calls; never deletes branches.
- AC: `pipeline-execution.test.ts` drives a stubbed single-lane `ready` settlement proving comment-before-close on preceding PRs with no branch deletion; proves the exclusion set issues no calls; proves failures record `supersedeFailures`, continue candidates, and still derive `succeeded`; fails against the baseline.

## Slice 3 — cleanup retires proven-superseded branches

- Cleanup accepts a closed PR as retirement authority only when it owns the candidate branch head, carries the exact supersede comment, and the referenced same-repo PR is merged; applies to materialized-worktree retirement and local-ref pruning; every broken proof component stays ineligible; existing live-run/daemon/base-branch guards remain; local-only, never remote deletion.
- AC: `cleanup.test.ts` proves retirement of a materialized superseded branch and pruning of an eligible head-only branch under full proof; proves a merely closed PR and each broken component remain ineligible; existing merged-PR retirement tests stay green; fails against the baseline.

## Documentation updates

- `v2/docs/install-and-config.md` — policy values, default, validation. `v2/docs/first-workflow-walkthrough.md` — inter-stage PRs are review surfaces; terminal settlement closes them. `v2/docs/daemon-host.md` — supersede ordering, exclusions, nonfatal failure detail. `v2/docs/state-store.md` — durable `supersedeFailures`. `v2/docs/operator-runbook.md` — superseded-branch retirement authority and refusals. `v2/docs/v1-behaviors.md` — record all three slices.
