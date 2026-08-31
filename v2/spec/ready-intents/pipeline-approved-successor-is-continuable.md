---
name: pipeline-approved-successor-is-continuable
---

# Approved pipeline successors dispatch live and on resume

Unsplit rationale: Approval continuation and pending-strand recovery both change daemon pipeline continuation policy; CLI grammar, RPC shape, and persistence schema stay unchanged.

## Primary implementation surface

- Daemon pipeline continuation and resume admission in `v2/src/daemon/pipeline-execution.ts`

## Prerequisites

## Problem

- `pipeline approve <pipeline-id> <stage-id> default` durably records `approved` but passes the default-lane sentinel as a scoped continuation, so the admitting daemon can skip the default prefix and leave the successor `pending` without a run row.
- `pipeline resume` refuses that durable approved-gate plus pending-successor shape, leaving daemon restart continuation as the only recovery.

## Behavior

- Applying approval to a reached gate dispatches its successor on the admitting daemon, including a daemon auto-started by the CLI; dispatch either creates the successor run linkage or settles a named failure.
- Unscoped and explicit-default `pipeline resume` admit an approved gate with a reachable undispatched successor and continue it without reopening a failed stage.
- Named-lane `pipeline resume` admits the same stranded shape only for that lane and leaves sibling gates and stages unchanged.
- Terminal succeeded and rejected pipelines remain non-resumable and dispatch nothing.

## Decision ledger

- Treat the persisted `default` lane as whole-pipeline continuation scope; rules out interpreting the sentinel as a named fan-out suffix and skipping the default prefix.
- Derive pending-strand recovery from an approved reachable gate followed by its first pending workflow successor; rules out a new durable status or recovery marker and rules out admitting arbitrary `pending` pipelines.
- Named-lane recovery continues only the requested lane; rules out using aggregate state to dispatch siblings.
- Preserve `pipeline_terminal_succeeded` and `pipeline_terminal_rejected` refusals; rules out widening pending recovery to terminal pipelines or replacing their specific diagnostics with `pipeline_not_resumable`.

## Acceptance criteria

- [ ] A regression in `v2/src/daemon/daemon-pipeline-approval.test.ts` sends `pipeline_approve` with `branchKey: "default"` after a succeeded predecessor and proves the admitting daemon creates the pending successor's run linkage without restart; it fails against the pre-fix path that leaves the successor `pending` with `workflowInvocationId: null`.
- [ ] An auto-start command-path regression proves approval admitted by a newly started daemon reaches the same successor-dispatch path rather than depending on a later startup continuation sweep.
- [ ] Regressions in `v2/src/daemon/pipeline-execution.test.ts` and `v2/src/daemon/daemon-pipeline-resume.test.ts` prove unscoped, explicit-default, and named-lane resume admit an approved-gate plus pending-successor strand, create the successor run linkage, and leave non-target lanes unchanged; they fail against the pre-fix `pipeline_not_resumable` refusals.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `refuses terminal succeeded and rejected pipelines without stage dispatch` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — state that approval dispatches the successor on the admitting daemon, define default-lane continuation scope, and add approved-gate pending strands to unscoped and named-lane resume admission.
- `v2/docs/operator-runbook.md` — state that approval on an explicitly started or auto-started daemon advances without restart and that `pipeline resume` recovers an approved-gate pending strand.
- `v2/docs/v1-behaviors.md` — record the corrected existing approval-continuation and pending-resume behavior in the parity baseline.
