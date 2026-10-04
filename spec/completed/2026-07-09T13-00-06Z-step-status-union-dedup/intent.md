---
name: step-status-union-dedup
---

# Dedupe the workflow step-status union

## Problem

The 4-value step-status string union (`"pending" | "in_progress" |
"completed" | "stopped"`) is defined independently on both wire sides:
`WorkflowStepListStatus` in `v2/src/daemon/daemon.ts:304` and the inline
literal in `DaemonWorkflowStepSnapshot.status` in
`v2/src/daemon/daemon-wire.ts:6-18`. The two can drift silently.

## Direction

Keep one definition; the other side imports it.

## Decisions

- `daemon.ts` is the canonical definition site and `daemon-wire.ts` imports
  it — matches the existing import direction (`daemon-wire.ts` already
  imports `WaitRunCompletionResult` from `daemon.ts`); rules out inverting
  that direction just for this one type.

## Prerequisites
