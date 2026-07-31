---
name: implement-ignores-project-pipeline-config
---

# Implement ignores project pipeline config

## Problem

`jarvis run workflow implement` refuses pre-admission with `invalid-project-pipeline-config` when
`projects.<name>.pipeline` is present but fails current validation — even though implement never
reads, resolves, or executes a pipeline. Present-and-stale is fatal; every future required pipeline
key repeats the break. Present-and-valid currently resolves and attaches `pipelineDefinition`, which
implement also never consumes.

Splitting does not apply: the behavioral change is confined to implement preset admission
(`execution-loop`); `pipeline start` keeps existing CLI validation unchanged.

## Decisions

- `implement` does not read, validate, or resolve `projects.<name>.pipeline` — absent, valid, or
  stale; admission never attaches `pipelineDefinition`. Reverses the valid-present path from
  `absent-pipeline-admits-implement`.
- `pipeline start` keeps full pre-admission validation of the same block unchanged — rules out weakening the surface that actually executes pipelines.
- Config load does not reject an unparseable `pipeline` block for non-pipeline commands; refusal belongs to the command that reads it — rules out moving the hard failure into `loadMachineConfig`.
- Deferred to first consumer: whether `config show` should warn about a stale `pipeline` block — pin when a caller needs it.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` — admits implement when `projects.<key>.pipeline` is missing `terminalAction` or structurally invalid (e.g. `reviewOverrides` is not an object); both yield `ok: true` with no `pipelineDefinition`; fails against the baseline.
- [ ] `workflow.test.ts` — `jarvis run workflow implement` admits and dispatches against the same stale configs (missing `terminalAction`, structurally invalid `reviewOverrides`); fails against the baseline.
- [ ] `workflow.test.ts` — rewrites `"project pipeline selection gates implement before durable admission effects"` so present+valid pipeline admits with no `pipelineDefinition`; removes `"pipeline %s failure precedes daemon and implement effects"` matrix expectations that implement runs project-pipeline resolution.
- [ ] `pipeline.test.ts` — adds missing-`terminalAction` pre-admission refusal (existing `"rejects invalid project pipeline configuration before daemon connect"` covers empty `name` only); `jarvis pipeline start` still refuses with `invalid-project-pipeline-config` naming `projects.<name>.pipeline.terminalAction`; inverting `pipeline.ts` pre-admission resolution refusal makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `implement-workflow-steps.test.ts` — inverting the implement admission guard that skips project-pipeline resolution makes the stale-config admission test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `v2/docs/operator-runbook.md`, `v2/docs/workflow-runner.md`, and `v2/docs/install-and-config.md` state implement ignores `projects.<name>.pipeline` entirely (no present-key resolution on admission); pipeline start still requires a valid block.

## Documentation updates

- `v2/docs/operator-runbook.md` — implement ignores `projects.<name>.pipeline`; pipeline start still requires a valid block.
- `v2/docs/workflow-runner.md` — implement admission contract: no project-pipeline resolution when key is present.
- `v2/docs/install-and-config.md` — `pipeline` key applies to `jarvis pipeline start` only; implement admission does not share project-pipeline resolution.
- `v2/docs/v1-behaviors.md` — record that standalone implement no longer resolves project pipeline config (present or absent).

## Prerequisites
