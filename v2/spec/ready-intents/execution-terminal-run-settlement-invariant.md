---
name: execution-terminal-run-settlement-invariant
---

# Enforce honest terminal settlement across execution paths

## Primary implementation surface

Execution loop

## Problem

Write-loop and workflow-runner completion, publication, repair, and resume tails still hand-order terminal status, loop outcome, PR evidence, and failure detail. Point fixes have corrected individual paths, but no repository guard prevents another direct terminal write.

## Behavior

- Inventory every production terminal transition under `v2/src/execution/` and route completion boundaries, publication tails, repair outcomes, watchdogs, and resume settlement through the atomic state-store operation.
- Prove that an observer reading `completed` immediately always finds the PR or other terminal-action evidence required by that path, and that failure statuses expose their matching loop outcome and failure detail.
- Add a structural test over production store usage that fails when any terminal status is written outside the single settlement operation.
- Document workflow settlement routing in `v2/docs/workflow-runner.md`, align completion semantics in `v2/docs/write-behavior.md`, and record the changed v2 behavior in `v2/docs/v1-behaviors.md`.

## Decision ledger

- Execution callers submit status, `loopOutcomeKind`, and available publication or failure evidence in one settlement call; rules out restoring evidence-before-status hand-ordering as the permanent contract.
- The audit covers fresh, resumed, repair, watchdog, reviewed-landing, and completion-publication paths; rules out declaring the invariant complete from one happy-path migration.
- The structural guard scans production terminal writes and permits only the settlement implementation; rules out a convention-only invariant that silently regresses.
- Tests mutate the real structural guard and pin the completed-observer ordering without production inversion hooks; rules out test-only bypass exports.

## Prerequisites

- The state store provides one transaction that commits terminal status, finish metadata, cause, and supplied evidence, and its fault-injection test proves partial terminal visibility is impossible.
- Every daemon-owned terminal transition routes through that transaction while preserving guarded kill, owner-liveness, startup reconciliation, queue, and resume behavior.
