---
name: workflow-terminal-incident-fires-once
---

# A workflow invocation's terminal incident fires once, when the invocation has actually finished

## Problem

`run-ad-hoc-terminal` is documented as firing only once every row of a workflow invocation has settled (`v2/docs/operator-runbook.md` § Deciding a workflow is finished). Two mechanisms break that:

1. **Timestamped key.** `invocationTerminal` keys the transition as `terminal:${status}:${invocationSettledAt(rows)}` (`v2/src/daemon/operator-incidents.ts:364`, `:381`), and `invocationSettledAt` (`:338`) is the latest status write on any row. Any later status write re-keys the incident and notifies again. `pipeline-terminal` keys on `terminal:${state}` with no timestamp (`:166`, `:520`) and cannot re-notify this way.
2. **Liveness is per-daemon memory.** "All settled" comes from `resolveWorkflowRunRollup` (`v2/src/persistence/workflow-run-status-rollup.ts:61`) using `isLive` from `workflowInvocationIsLive` (`v2/src/daemon/daemon.ts:297`), which is true only when *this* daemon holds the workflow promise. During the publication tail a review row already reads `completed`; a daemon that does not own the run (a draining or incoming generation sweeping the shared store) sees every row terminal and emits early. Pipelines avoid this because stage settlement runs in the owning daemon's workflow `finally` (`settleStagesForEntryRun`, `v2/src/daemon/daemon-workflow-admission-handlers.ts:289-305`).

## Evidence

2026-09-17, standalone plan invocation, entry run `fd74b38e`: `terminal:completed:1789616031515` emitted while review row `d237bd72` was still in its publication tail, then `terminal:completed:1789616056589` when the tail finished and PR #3968 published. Two daemon generations were live at the time. Delivery ledger, last 5 days: 5 of ~3,275 invocations delivered more than one terminal incident (`fd74b38e`, `c97bc45d` completed twice; `5d0d3d0d` completed then failed; `a2762fc9` failed twice; `f2e8783a` failed three times). Operator reports seeing it repeatedly.

## Decisions

- The owning daemon writes a durable invocation-settled marker (cause and time) when the workflow promise ends — the same point pipeline stage settlement uses. `run-ad-hoc-terminal` derives only from that marker, never from row-status max time or in-memory liveness. Rules out a second definition of "finished" for ad-hoc workflows.
- The transition key is stable per invocation outcome (`terminal:${cause}`); a changed cause (completed → failed after a failed republication) notifies once more with the new cause, matching `pipeline-terminal`.
- Any daemon may sweep; a daemon that does not own the invocation emits nothing until the marker exists.
- Invocations settled before the marker existed keep their delivered incidents (no mass re-notification on upgrade).

## Acceptance criteria

- [ ] A test with a review row settled `completed` and its publication tail still running, swept by a daemon that does not own the invocation, derives no `run-ad-hoc-terminal`; it fails against the current rollup.
- [ ] A test asserts one invocation derives exactly one `run-ad-hoc-terminal` even when a row's `status_changed_at` is rewritten after the marker is written; it fails against the timestamped key.
- [ ] A test asserts the marker is written when the workflow promise settles (completed, failed, killed) and that the incident's cause matches it.
- [ ] A test asserts a completed-then-failed republication yields exactly two deliveries (`completed`, then `failed`).
- [ ] A test asserts pre-existing delivered terminal incidents are not re-delivered after upgrade.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Operator notifications — marker-based derivation and key.
- `v2/docs/operator-runbook.md` § Deciding a workflow is finished — keep the one-incident guarantee accurate.
