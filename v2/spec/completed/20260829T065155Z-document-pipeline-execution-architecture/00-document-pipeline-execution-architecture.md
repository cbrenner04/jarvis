# Document pipeline execution architecture

## Problem

Pipeline execution has no single durable architecture owner. Definitions, admission, durable stage state, daemon dispatch, fan-out, approval, settlement, terminal publication, and recovery are split across source and operator prose, which obscures current ownership and the boundaries of pending dispatch and settlement changes.

## Decision ledger

- `v2/docs/pipeline-execution.md` owns the cross-file execution contract. `v2/docs/workflow-runner.md`, `v2/docs/daemon-host.md`, `v2/docs/v2-architecture.md`, and pipeline recovery entries in `v2/docs/operator-runbook.md` link to it and state their component-level scope; rules out any of them, fix-spec history, or fragments becoming a competing architecture owner.
- Current dispatch and settlement mechanics are labeled merge-day behavior. Before implementation, promote the consumable `pipeline-dispatch-shares-cli-front-door` and `pipeline-settlement-derives-from-run-rows` seeds to stable tracking artifacts, then link those artifacts as pending targets; rules out documenting either current duplication or unlanded restructuring as settled architecture.
- This spec lands before either overlapping dispatch or settlement restructure. If either lands first, replan this spec against that merged behavior rather than documenting a stale baseline.
- Lifecycle, recovery, and refusal claims cite locally resolvable exported symbols or named tests, not broad file citations. Recovery traceability covers only direct durable mutations, refusals, and no-effect outcomes from `pipeline resume` and `pipeline recover`; ordinary downstream execution stays in the general lifecycle contract. Daemon-start continuation cites its entry paths and pinning tests without claiming every downstream transition.
- `PipelineContext` immutability means the persisted admission snapshot is not subsequently mutated; it does not assert completeness or validity. Its documentation covers optional fields, ambiguous or dual-populated `seed`/`seedPath` records, and continuation when context is missing.

## Tasks

- Add `v2/docs/pipeline-execution.md` as the canonical architecture page covering definition and registry resolution; admission and the persisted `PipelineContext` snapshot; stage resolution, dispatch, claims, stage-to-entry-run linkage, and settlement; fan-out lanes; approval gates; derived state; terminal publication; daemon restart continuation; and operator recovery.
- Trace each lifecycle, recovery, and refusal claim to a locally resolvable symbol or named test in the relevant seam, including `pipeline-definition.ts`, `pipeline-registry.ts`, `project-pipeline-resolution.ts`, `pipeline-start-admission.ts`, `state-store.ts`, `pipeline-stage-resolve.ts`, `pipeline-stage-dispatch.ts`, `pipeline-execution.ts`, `pipeline-stage-recovery.ts`, `terminal-publication.ts`, and their co-located tests.
- Include a compact lifecycle reference that lists the implemented durable status vocabulary by workflow and approval stage kind; each allowed source-to-destination transition; its transition owner; and ownership of timestamps, entry-run linkage, artifacts, and failure fields.
- Include an operator-facing recovery eligibility reference for unscoped and branch-scoped `pipeline resume` and `pipeline recover`. For each outcome, distinguish admitted, refused, and no-effect behavior, including terminal and approval states, live deferred settlement, missing context, active claims, unsupported recover targets, and operator blockers. Cite direct durable mutations, refusals, and no-effect outcomes; leave malformed transport behavior to `daemon-host.md` and fan-out publication refusal to terminal publication.
- Cite daemon-start continuation entry paths and pinning tests, including deferred or unsettled re-settlement and blocked plan-stage behavior, without enumerating downstream execution transitions.
- Mark the current hand-built daemon workflow-start assembly and copy-then-redrive settlement as current state, including the deferred-resume loss of PR evidence and resulting terminal-publication failure. Before linking targets, promote the `pipeline-dispatch-shares-cli-front-door` and `pipeline-settlement-derives-from-run-rows` seeds to stable tracking artifacts; link those as pending boundaries only.
- Document terminal publication outcomes: absent action, `leave-draft`, `ready`, and `merge`; required PR evidence; durable success and failure fields; restart continuation; retry and resume limits; and the fail-closed unsupported fan-out path.
- Add a pipeline-layer summary and canonical-page link to `v2/docs/v2-architecture.md`, and links plus component-scope boundaries to `v2/docs/workflow-runner.md` and `v2/docs/daemon-host.md`.
- Cross-link the canonical page from `v2/docs/operator-runbook.md` pipeline resume, pipeline recover, and wedged pipeline-stage recovery guidance without copying architecture prose into the runbook.

## Acceptance criteria

- [x] `v2/docs/pipeline-execution.md` is the canonical cross-file owner: it covers definitions/registry, admission and the persisted `PipelineContext` snapshot, lifecycle ownership, resolution/dispatch, stage-to-entry-run linkage and settlement, fan-out lanes, approval gates, derived state, terminal publication, restart continuation, and operator recovery. `workflow-runner.md`, `daemon-host.md`, `v2-architecture.md`, and the named operator-runbook recovery entries link to it and retain only their component-level contracts.
- [x] The lifecycle reference names the implemented status vocabulary by workflow and approval stage kind, every allowed source-to-destination transition and owner, and ownership of timestamps, entry-run linkage, artifacts, and failure fields; every lifecycle, recovery, and refusal claim cites a locally resolvable symbol or named test.
- [x] The recovery eligibility reference distinguishes admitted, refused, and no-effect outcomes for unscoped and branch-scoped `pipeline resume` and `pipeline recover`, including terminal and approval states, live deferred settlement, missing context, claims, unsupported recover targets, and operator blockers. It traces only direct durable mutations, refusals, and no-effect outcomes, while daemon-start continuation cites entry paths and pinning tests separately.
- [x] `PipelineContext` documentation defines immutability as preservation of its admission snapshot rather than validity or completeness, including optional fields, ambiguous or dual-populated `seed`/`seedPath` records, and missing-context continuation behavior.
- [x] Merge-day hand-built dispatch and copy-then-redrive settlement, including deferred-resume PR-evidence loss and its terminal-publication failure, are distinct from the shared-front-door and run-row-derived-settlement targets. The targets link stable promoted tracking artifacts and are explicitly pending; this documentation spec precedes either restructure, or is replanned against whichever merged behavior lands first.
- [x] Terminal-publication documentation distinguishes absent action, `leave-draft`, `ready`, and `merge`; required PR evidence; durable success and failure state; restart continuation; retry/resume limits; and the fail-closed unsupported fan-out path.
- [x] `v2/docs/v2-architecture.md` summarizes and links the pipeline layer, `v2/docs/workflow-runner.md` and `v2/docs/daemon-host.md` link it as the canonical cross-file contract while retaining component scope, and the pipeline resume, pipeline recover, and wedged-stage recovery entries in `v2/docs/operator-runbook.md` link it without duplicating the contract.
- [x] `bun run lint:md`, `bun run typecheck`, and `bun run test` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — canonical pipeline execution architecture and recovery reachability.
- `v2/docs/v2-architecture.md` — pipeline-layer summary and canonical link.
- `v2/docs/workflow-runner.md` — component-scope boundary and canonical link.
- `v2/docs/daemon-host.md` — component-scope boundary and canonical link; malformed transport behavior remains here.
- `v2/docs/operator-runbook.md` — canonical links from pipeline recovery guidance.
