---
name: pipeline-architecture-doc
---

# Write the pipeline architecture doc

## Problem

The pipeline layer (~6k lines: `pipeline-execution.ts`, `pipeline-stage-{resolve,dispatch,recovery}.ts`, `commands/pipeline.ts`, registry/definitions) has no architecture doc: `v2-architecture.md` never mentions pipelines, and `workflow-runner.md`'s 448-line equivalent has no pipeline counterpart. The layer grew entirely through seed/fix cycles; the 2026-08-29 review traced most of its defect classes to seams nobody designed in one place (dispatch parity, settlement ownership, stage↔run join). The restructure seeds ([[pipeline-dispatch-shares-cli-front-door]], [[pipeline-settlement-derives-from-run-rows]]) need a stated target architecture to converge on rather than each plan re-deriving it.

## Decisions

- New `v2/docs/pipeline-execution.md`: definitions/registry, admission and `PipelineContext`, stage lifecycle states and who advances them, dispatch path and its shared front door with the CLI, settlement ownership, fan-out lanes, approval gates, recovery verbs (`resume`/`recover`) and what each reaches, and the stage↔run join. Rules out the knowledge living only in fix-PR descriptions.
- `v2-architecture.md` gains a pipeline section linking it. Rules out the top-level doc omitting the primary orchestration layer.
- Document the *current* mechanics with the restructure targets marked as such, so it is correct on merge day and names where it will change. Rules out a doc that is aspirational fiction or instantly stale.

## Acceptance criteria

- [ ] `v2/docs/pipeline-execution.md` exists covering the listed sections with file references, and `v2-architecture.md` links it.
- [ ] Every recovery verb's reachable stage states match a pinned test or a named code path.
- [ ] `bun run lint:md` passes.

## Documentation updates

- This seed is the documentation update; cross-link from `operator-runbook.md`'s pipeline recovery entries.
