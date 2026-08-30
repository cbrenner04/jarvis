---
name: document-pipeline-execution-architecture
---

# Document the pipeline execution architecture

## Primary implementation surface

`v2/docs/pipeline-execution.md`

Unsplit rationale: The architecture page and its navigation/recovery cross-links form one documentation surface; splitting them would leave the durable contract incomplete.

## Prerequisites

## Problem

Pipeline execution spans definitions, admission, durable stage rows, daemon dispatch, fan-out, approval, settlement, and recovery without one durable architecture owner. Existing workflow-runner and operator prose is fragmented, while pending dispatch and settlement restructures need an explicit current-state baseline and target boundary.

## Decisions

- `v2/docs/pipeline-execution.md` owns the cross-file pipeline execution contract and links source/test seams; rules out fix-PR history or `workflow-runner.md` fragments remaining the only architecture record.
- The document separates merge-day mechanics from the pending shared workflow-start front door and run-row-derived settlement targets; rules out presenting either current duplication or unlanded restructuring as the settled design.
- Recovery reachability names a pinning test or code path for each `pipeline resume` and `pipeline recover` stage-state transition; rules out operator guidance broader than implemented recovery.
- `v2/docs/v2-architecture.md` summarizes and links the pipeline layer, while `v2/docs/operator-runbook.md` recovery entries link the architecture owner; rules out duplicating the full contract across navigation and runbook pages.

## Behavior

The architecture page documents definitions and registry lookup, start admission and immutable `PipelineContext`, durable stage lifecycle states and transition ownership, stage resolution and dispatch, the current stage-to-entry-run join, settlement ownership, fan-out lanes, approval gates, terminal publication, and restart/operator recovery. File references make each claim traceable, and target annotations identify the two pending restructure seams without changing current operator semantics.

## Acceptance criteria

- [ ] `v2/docs/pipeline-execution.md` covers definitions/registry, admission and `PipelineContext`, stage lifecycle ownership, resolution/dispatch, stage-to-run linkage, settlement, fan-out lanes, approval gates, terminal publication, and recovery with source or test references.
- [ ] Current dispatch and settlement mechanics are distinct from the shared-front-door and run-row-derived-settlement targets.
- [ ] Every `pipeline resume` and `pipeline recover` reachable stage state cites a pinning test or named code path.
- [ ] `v2/docs/v2-architecture.md` links the pipeline architecture page, and pipeline recovery entries in `v2/docs/operator-runbook.md` cross-link it without duplicating the contract.
- [ ] `bun run lint:md`, `bun run typecheck`, and `bun run test` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — canonical pipeline execution architecture.
- `v2/docs/v2-architecture.md` — pipeline layer summary and link.
- `v2/docs/operator-runbook.md` — recovery cross-links.
