---
name: exhausted-red-ready-gate-settles-failed-and-resumable
---

# Exhausted red ready gate settles failed and resumable, not completed

## Problem

When every ready-gate repair attempt stays red, the implement run still settles `completed` with criteria ticked and a draft PR over the broken commit. The operator cannot `run resume` (terminal row) and cannot re-dispatch (lock held by a stray agent — addressed in a sibling intent).

## Decisions

- Repair budget exhaustion with a still-red gate settles `failed` with `ready_gate_failed`, not `completed` — rules out publishing success over a red gate.
- Criteria stay ticked; the failure is the gate, not the spec — rules out unticking on settle.
- That settle skips draft→ready flip — rules out flip on exhausted-red repair.
- The row is `resumable: true` with `nextAction: "resume"` — rules out stranding behind workspace retirement for gate retry.
- `jarvis run resume` re-runs the ready gate without re-entering the write loop — rules out full implement re-entry for gate-only recovery.
- A gate that goes green on a repair attempt still completes as today — rules out regressing the green-repair success path.

## Acceptance criteria

- [ ] A run whose gate returns non-zero on every repair attempt settles `failed` with `error.reason: "ready_gate_failed"`; a test drives an always-red gate through the repair budget and fails against the current `completed` settle.
- [ ] That run publishes no draft→ready flip and its durable row reports `resumable: true` with `nextAction: "resume"`; `jarvis run resume` on it re-runs the gate without re-entering the write loop.
- [ ] A gate that goes green on a repair attempt still completes exactly as today; existing coverage stays green.
- [ ] Inverting the exhausted-red-gate guard turns the first acceptance test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — repair exhaustion settles `failed` and is resumable; delete any claim that a `completed` implement row implies a green gate.
- `v2/docs/write-behavior.md` — repair budget exhaustion settles `failed` with `ready_gate_failed`, not `completed`.

## Prerequisites
