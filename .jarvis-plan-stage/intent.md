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

- [ ] `workflow-runner.test.ts` `"caps ready gate repairs and settles as ready_gate_failed when exhausted"` (or a sibling test in that file) asserts the durable row settles `runStatus: "failed"` with `error.reason: "ready_gate_failed"` and `resumable: true`; it fails against the current `runStatus: "completed"` settle.
- [ ] That run publishes no draft→ready flip; `run list`, `run wait`, and `composeRunOperatorError` / resume admission align on `runStatus: "failed"`, `resumable: true`, and `nextAction: "resume"`; `jarvis run resume` re-runs the gate without re-entering the write loop.
- [ ] `write-loop.test.ts` `"repairs a red ready gate through a write iteration"` and `workflow-runner.test.ts` `"routes a red ready gate through bounded repair before settlement"` stay green.
- [ ] Inverting the exhausted-red-gate guard turns `workflow-runner.test.ts` `"caps ready gate repairs and settles as ready_gate_failed when exhausted"` RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — repair-budget exhaustion settles `failed` / `ready_gate_failed` / resumable; keep the claim that a genuinely `completed` implement row implies a green gate.
- `v2/docs/write-behavior.md` — repair budget exhaustion settles `failed` with `ready_gate_failed`, not `completed`.
- `v2/docs/v1-behaviors.md` — same operator-visible settle semantics.

## Prerequisites
