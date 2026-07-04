# 00 - Daemon workflow step status snapshot

Extend daemon run snapshots so the TUI can see workflow-step progress for a selected run without a new RPC.

## Prerequisites

- Merged linear workflow runner: `v2/spec/completed/2026-07-04T03-01-30Z-workflow-runner-linear-steps/01-linear-workflow-runner.md`.
- Durable `(project, branch, stepId)` resume state in `v2/docs/state-store.md`.

## Decisions

- Expose workflow step status on daemon `list` rows; rules out a new TUI-only RPC or using blocking `wait` for live step state.
- Single-step rows omit workflow metadata and keep existing meaning; rules out changing existing single-step consumers.
- One workflow-backed `list` row is assembled from that row's own workflow invocation snapshot, not by scanning unrelated run rows; rules out grouping steps by `(project, branch)` recency alone.
- The workflow invocation snapshot retains the authored `steps[]` metadata (`stepId`, `role`, authored order) for the row while live and after quiescence; rules out reconstructing future or completed steps from durable attempts alone.
- Workflow step order in the snapshot matches the invocation snapshot's authored workflow order; rules out sorting by last activity or attempt recency.
- Each step snapshot carries `stepId`, `role`, `status`, terminal outcome when present, and attempt count; rules out forcing the TUI to derive labels or counts from logs.
- Step `status` is the closed wire vocabulary `pending | in_progress | completed | stopped`; rules out leaking daemon-only run statuses into the TUI contract.
- `terminalOutcome` is present only for `completed` and `stopped` steps; `completed` pairs only with `complete`, while `stopped` carries the existing non-complete stop vocabulary for a step (`blocked`, `contract_miss`, `invocation_failure`, `budget-exhausted`, `paused`, `killed`); rules out ambiguous status/outcome combinations.
- Attempt count reflects started durable attempts for that step, including an active in-progress attempt; rules out completed-only counts.
- Exactly one step may be `in_progress` in a live snapshot, and no step is `in_progress` once the workflow is quiescent; rules out multi-active or stale-active presentation because the runner is linear.
- Steps before the active step surface their settled outcome as `completed` or `stopped`; rules out requiring the TUI to join `list` with `wait` or log replay.
- Steps after the last started step surface as `pending`; rules out inventing terminal state before a step run exists.
- A completed workflow-backed row has no active step: every authored step is terminal and the final step is `completed` with `terminalOutcome: "complete"`; rules out leaving the normal success case implicit.
- `jarvis run list` CLI text output stays the current eight columns and ignores workflow metadata; rules out script-facing output churn in this slice.
- Deferred to first consumer: CLI or JSON surfacing of workflow metadata outside `jarvis tui` — pin when another caller needs it.

## Task checklist

- Extend daemon `list` wire payloads with optional workflow-step snapshot data for workflow-backed runs.
- Source workflow-backed row assembly from the row's own workflow invocation snapshot plus per-step durable state for that invocation.
- Derive per-step status from durable step runs plus the daemon's live run state.
- Preserve existing `list` row behavior for single-step runs and existing `wait` behavior.
- Add parser/validator coverage for the new optional wire payload.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [x] Daemon `list` returns workflow-backed rows with step snapshots that identify the active step, prior steps' outcomes, future pending steps, and per-step attempt counts.
- [x] The workflow-backed `list` row uses its own stored authored steps to surface `stepId`, `role`, and future pending steps even after the workflow has gone quiescent.
- [x] For a live workflow run, refreshed daemon `list` snapshots move the active-step marker only after the prior step reaches its durable boundary.
- [x] For a resumed workflow run, daemon `list` reports attempt counts independently per `stepId` rather than as one workflow-global count.
- [x] When a workflow run stops before the last step, daemon `list` still returns the last executed step's terminal outcome and leaves later steps pending.
- [x] When a workflow run completes all authored steps, daemon `list` returns no active step, marks the final step `completed` with `terminalOutcome: "complete"`, and leaves no authored step pending.
- [x] Single-step runs still parse through daemon `list` without workflow metadata, and `jarvis run list` keeps its current eight-column text output.
- [x] `v2/src/daemon/daemon-wire.test.ts` or equivalent accepts only `pending | in_progress | completed | stopped` step statuses, enforces the allowed `terminalOutcome` combinations, and rejects malformed workflow-backed `list` payloads.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document optional workflow-step metadata on daemon `list` rows.
- `v2/docs/workflow-runner.md` — note that daemon/TUI consumers may read workflow progress as per-step snapshots keyed by authored order and `stepId`.
