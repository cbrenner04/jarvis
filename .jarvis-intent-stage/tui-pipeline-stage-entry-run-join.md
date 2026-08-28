---
name: tui-pipeline-stage-entry-run-join
---

# Join pipeline stages through their recorded entry runs

Unsplit rationale: The required fix is one TUI pipeline-tree projection behavior; daemon persistence and wire projection stay unchanged.

## Primary implementation surface

- TUI pipeline-tree join projection (`v2/src/tui/tui-monitor-pipeline-tree.ts`)

## Prerequisites

- Pipeline workflow dispatch and recovery persist the admitted entry run ID in the durable stage `workflowInvocationId` field.
- Daemon run rows expose globally unique `runId` values and each workflow row's distinct `workflow.invocationId`.
- Pipeline-tree branch attribution derives a stage's `(project, branch)` claims from runs joined to that stage.

## Problem

The TUI treats a stage's recorded entry run ID as a workflow invocation ID, so stage runs remain ad-hoc and branch-aware attribution has no stage claims.

## Behavior

- Resolve each stage's recorded entry run ID to its retained run row, then use that row's workflow invocation ID for stage joins, sibling grouping, claim construction, suppression, project derivation, and attributed timing.
- Keep a stage with no retained entry run unresolved and claimless; genuinely stage-less invocations remain ad-hoc.

## Decision ledger

- Resolve `run.runId === stage.workflowInvocationId` before every invocation-based consumer; rules out repairing only stage-node construction while suppression, claims, project, or timing still compare unlike IDs.
- Treat run IDs as globally unique for the lookup; rules out daemon or project scoping that can reject the recorded entry row.
- An unresolved entry run ID yields no invocation, joined runs, or claims; rules out guessing an invocation from branch data.
- Keep the durable and wire field named `workflowInvocationId` in this repair and document that it contains an entry run ID; rules out coupling the projection fix to a store/wire migration.
- Re-fixture pipeline-tree tests to keep entry run IDs distinct from workflow invocation IDs; rules out production-inaccurate fixtures that let direct field comparison pass.
- Preserve branch-aware claim shape and tie-breaking after resolution; rules out redesigning #2959 while activating it.

## Required verification

- A pure `buildMonitorPipelineTreeJoin` test uses distinct entry-run and invocation UUIDs, joins the entry run and invocation siblings under the stage, and emits none as ad-hoc; it fails against direct stage-field comparison.
- The same-branch leaked-invocation keystone uses a production-shaped stage fixture and fails when resolved-invocation claim construction reverts to direct stage-field comparison.
- A missing retained entry run leaves the stage empty and claimless without mis-attributing any run.
- A genuinely stage-less invocation remains a top-level ad-hoc row.
- Pipeline-tree fixtures use the production ID relationship except where unresolved entry-run behavior is the test subject.
- `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — correct the TUI pipeline-tree, dock-count, and multi-daemon entries: the stage field records an entry run ID, which the tree resolves to the workflow invocation before joining or attribution.
- `v2/docs/operator-runbook.md` — Observe: record the entry-run-to-invocation resolve, unresolved-retention behavior, and production-shaped fixture requirement.
