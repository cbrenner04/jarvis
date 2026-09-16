---
name: plan-preflight-gates-against-resolved-base
---

# `specs: repo` stale-workspace preflight gates evaluate against the resolved base

The stale-workspace preflight gates (descendant check, landed criteria, dirty reuse) for a `specs: repo` plan re-run evaluate against the resolved base, not the repository default. An incomplete re-run whose worktree `HEAD` is not descended from the explicit base is refused naming that base, so a base override cannot silently bypass the descendant gate.

## Prerequisites

- plan accepts --base <ref> and threads the resolved base into the plan workflow input
- the resolved base drives the specs:repo plan worktree checkout via buildPlanWorkflowSteps

## Documentation updates

- `v2/docs/operator-runbook.md` — § Concurrency: note that the `specs: repo` stale-reuse gates evaluate against the resolved `plan --base`.
