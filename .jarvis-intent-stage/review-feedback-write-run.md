---
name: review-feedback-write-run
---

# Review-feedback preset write step lands fixes on the lane PR

## Problem

Even with admission and captured review input, no workflow preset runs an agent iteration that fixes review findings and republishes through the normal gate to the same PR.

## Behavior

A new standalone workflow preset registers with its own `prompts/<preset>/` set (plan-prompt coherence, render-observer coverage for every registered prompt). Its write step injects the captured review artifact and only enough plan/implement context to interpret what the PR built — no acceptance-criteria ticking, subspec routing, index edits, or new scope. On `done`/`no-work`, the harness runs the configured ready gate, mutation verification, and completion publication that refresh the **same** branch and open PR.

## Acceptance criteria

- [ ] A regression test drives the preset through a mocked write loop and completion publisher and fails against the pre-fix absence; it asserts commits stay on the admitted branch, publication targets the existing PR, and prompt rendering includes the review artifact without implement index-routing bindings.
- [ ] Render-observer tests cover every new registered prompt id.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — review-feedback re-entry preset steps, prompts, and publication path.
- `v2/docs/operator-runbook.md` — starting a review-feedback run after publication.

## Prerequisites

- The preset registry records whether each registered CLI workflow may be used as a pipeline stage `workflow` value, and pipeline definition validation rejects stage workflows marked standalone-only with a named error.
- PR review threads and comments for a lane's open PR are captured into one durable review artifact via `gh`, with the PR as the sole feedback source.
- Review-feedback CLI admission resolves a completed plan or implement lane to its branch, worktree, and open PR and refuses in-flight lanes, closed or merged PRs, and non-plan/implement targets by name.
