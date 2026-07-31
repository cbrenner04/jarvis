---
name: implement-ignores-project-pipeline-config
---

# Implement ignores stale project pipeline config

## Problem

`jarvis run workflow implement` refuses pre-admission with `invalid-project-pipeline-config` when
`projects.<name>.pipeline` is present but fails current validation — even though implement never
reads, resolves, or executes a pipeline. Present-and-stale is fatal; every future required pipeline
key repeats the break.

Splitting does not apply: the behavioral change is confined to implement preset admission
(`execution-loop`); `pipeline start` keeps existing CLI validation unchanged.

## Decisions

- `implement` does not validate `projects.<name>.pipeline` at all — rules out coupling the primary path to pipeline-phase schema churn.
- `pipeline start` keeps full pre-admission validation of the same block unchanged — rules out weakening the surface that actually executes pipelines.
- Config load does not reject an unparseable `pipeline` block for non-pipeline commands; refusal belongs to the command that reads it — rules out moving the hard failure into `loadMachineConfig`.
- Deferred to first consumer: whether `config show` should warn about a stale `pipeline` block — pin when a caller needs it.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` — admits implement when `projects.<key>.pipeline` is missing `terminalAction` and when the block is structurally invalid (e.g. `reviewOverrides` is not an object); both yield `ok: true` with no `pipelineDefinition`; fails against the baseline.
- [ ] `workflow.test.ts` — `jarvis run workflow implement` admits and dispatches a run against the same missing-`terminalAction` config; fails against the baseline.
- [ ] `pipeline.test.ts` — `jarvis pipeline start` against the same config still refuses pre-admission with `invalid-project-pipeline-config` naming `projects.<name>.pipeline.terminalAction`; inverting `pipeline.ts` pre-admission resolution refusal makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `implement-workflow-steps.test.ts` — inverting the implement admission guard that skips project-pipeline resolution makes the stale-config admission test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `v2/docs/operator-runbook.md` states implement ignores `projects.<name>.pipeline` entirely, replacing the weaker "treats `pipeline` as optional" wording.

## Documentation updates

- `v2/docs/operator-runbook.md` — implement ignores `projects.<name>.pipeline`; pipeline start still requires a valid block.
- `v2/docs/v1-behaviors.md` — record that standalone implement no longer resolves project pipeline config.

## Prerequisites

