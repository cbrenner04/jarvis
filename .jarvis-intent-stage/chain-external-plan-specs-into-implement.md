---
name: chain-external-plan-specs-into-implement
---

# Chain external plan specs into implement

## Primary implementation surface

Daemon request handling.

## Problem

A pipeline plan stage can publish its durable spec under the git-disabled external plan home, but chained implement resolution still assumes a Git-backed prior worktree/base relationship instead of dispatching the admitted external tree against the registered project.

## Prerequisites

- Shared `projectSafeId` maps registered project keys to the path segment used by git-disabled plan publication under `~/.jarvis/specs/<safeId>/plans/<name>/`.
- Implement CLI admission resolves a registered `plan.commit: false` external plan index to its owning project, preserves its canonical external identity, skips target-base membership for that tree, and completes preflight without materializing finished work.
- Implement execution routes, ticks, reviews, and completes the admitted external tree in place while all code, commits, publication, and gates stay on the ordinary worktree.
- Chained-stage project matching maps `~/.jarvis/specs/<projectSafeId>/plans/<name>/` to the registered project and pipeline admission root.

## Decision ledger

- Normalize the git-disabled plan artifact to its external `index.md` and dispatch it through the same implement admission and execution contract as standalone CLI runs; rules out a pipeline-only external-spec implementation path.
- Resolve implementation code from the pipeline's registered project and requested base while retaining the prior plan artifact as the spec read/write root; rules out Git base membership checks against the non-Git plan workspace.
- Preserve existing git-enabled chained plan-to-implement resolution and stage settlement; rules out changing ordinary worktree handoff semantics.
- Treat an already-complete chained external tree as `implement.already_complete` without materializing an implementation worktree; rules out daemon-only completion side effects.

## Acceptance criteria

- [ ] A chained-stage regression test drives a `plan.commit: false` plan artifact at `~/.jarvis/specs/<safeId>/plans/<name>/` into implement through real preset preparation and fails against the pre-fix chained launch.
- [ ] The dispatched implement step carries the external index identity and registered code project/base rather than treating the plan workspace as a Git preflight root.
- [ ] A complete external plan artifact settles through the shared already-complete admission without implementation worktree or agent creation.
- [ ] Existing git-enabled plan-to-implement normalization, matcher, dispatch, and settlement tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — define git-disabled plan-artifact normalization and implement-stage dispatch; cross-link the shared admission/execution contract.
- `v2/docs/workflow-runner.md` — record that standalone and chained implement share the external-spec contract without duplicating daemon resolution details.
- `v2/docs/operator-runbook.md` — state that a git-disabled plan pipeline continues through v2 implement and uses the external plan home.

## Out of scope

- Pipeline fan-out changes, matcher changes already landed separately, and v1 pipelines.
