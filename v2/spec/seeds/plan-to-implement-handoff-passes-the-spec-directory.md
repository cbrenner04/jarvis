---
name: plan-to-implement-handoff-passes-the-spec-directory
---

# Plan-to-implement handoff passes the spec directory, so the implement stage never starts

## Problem

The `plan` stage records its artifact `specPath` as the spec **directory**. The `implement` stage
passes that value straight through as `specPath`, and the implement builder requires an `index.md`
(or an explicit `--artifact`). Every configured-pipeline `implement` stage therefore fails at
resolution, before any worktree or run row exists.

This is not a fan-out-only defect: a single-branch `full-review` pipeline hits it too. The pipeline
phase was marked complete and dogfooded, but the dogfood runs had never reached `implement`.

## Evidence

Pipeline `6155fe8b-3301-45f2-8e67-aa15e093f9de` (`full-review` on `jarvis`), 2026-08-01. After
approving `approve-plan` for branch `tui-pipeline-tree-monitor`:

```json
{"stage_id":"implement","branch_key":"tui-pipeline-tree-monitor","status":"failed",
 "workflow_invocation_id":null,
 "failure_detail":{"message":"Non-index spec requires --artifact"}}
```

The preceding plan stage's recorded artifact, same pipeline:

```json
{"specPath":"v2/spec/20260801T122726Z-tui-pipeline-tree-monitor"}
```

All three plan branches recorded a bare directory. Source path:
`resolveImplementStage` (`v2/src/daemon/pipeline-stage-resolve.ts:356`) sets
`specPath: prior.specPath`; `resolveImplementArtifact`
(`v2/src/execution/implement-workflow-steps.ts:167-170`) rejects anything whose basename is not
`index.md` when no `artifactPath` is supplied.

Running `jarvis run workflow implement --base main --spec <dir>/index.md` by hand on the same spec
works, so only the handoff is wrong.

## Decisions

- The plan→implement handoff resolves the plan output to its routing `index.md` — either the plan stage records the index path as its artifact, or implement stage resolution appends `index.md` to a directory artifact. Rules out requiring an operator `--artifact` on a chained stage, which the pipeline has no way to supply.
- A plan artifact that is neither a directory containing `index.md` nor an index file fails with a message naming the resolved path and what was expected. Rules out the current bare `Non-index spec requires --artifact`, which does not say which path was passed or by whom.
- Coverage runs at the stage-resolution seam with a plan artifact shaped exactly as `resolvePlanWorkflowStage` records it today (a directory), not a hand-written index path. Rules out a test that passes because the fixture is already correct — that is why this shipped.
- Out of scope: the fan-out claim contention and terminal-state defects in `seeds/pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree`.

## Acceptance criteria

- [ ] Resolving an `implement` stage whose prior plan artifact `specPath` is a spec directory produces implement steps pointing at `<dir>/index.md`, with no `--artifact`.
- [ ] The plan-stage artifact recorded by `resolvePlanWorkflowStage` feeds that resolution unchanged — the test fixture is the recorded shape, not a corrected one.
- [ ] A prior artifact that is a directory without `index.md` fails with a message naming the resolved path and that an index was expected.
- [ ] An `implement` stage still resolves when the prior artifact already names an `index.md`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline section: what the plan stage hands to implement, and what a resolution failure before any run row looks like.

## Prerequisites

- `v2/src/daemon/pipeline-stage-resolve.ts` — `resolveImplementStage`, `resolvePlanWorkflowStage`, `resolvePriorArtifactContext`
- `v2/src/execution/implement-workflow-steps.ts` — `resolveImplementArtifact`
- `v2/src/daemon/pipeline-stage-dispatch.ts` — records stage `failure_detail` when resolution fails
