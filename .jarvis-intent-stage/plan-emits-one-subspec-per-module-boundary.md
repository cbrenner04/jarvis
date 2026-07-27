---
name: plan-emits-one-subspec-per-module-boundary
---

# Plan emits one subspec per module boundary

## Problem

The plan step emits drafted subspecs as-is. When one subspec's acceptance criteria own more than one
module boundary, the implement run's blast radius exceeds repair budget — often discovered only after
a failed run.

## Evidence (2026-07-27)

`implement-repairs-ticked-surviving-mutation-run` planned two subspecs far above the usual
reviewable size; its implement runs failed on breadth. Subspecs that stayed within one boundary
landed on first implement.

## Decisions

- When a drafted subspec's acceptance criteria span more than one module boundary, the plan step
  splits it into further subspecs and emits the split result. Rules out refusing, warning, or emitting
  with a note.
- A module boundary is the same notion as an intent-split surface: persistence, daemon request
  handling, CLI admission, execution loop, and comparable seams — not file count. Rules out a
  separate plan-only boundary vocabulary.
- The oversize signal is acceptance criteria that own more than one module boundary. Rules out a
  line-count threshold, numeric budgets in the plan prompt, and splitting when only `## Decisions`
  span boundaries while every acceptance criterion stays single-boundary.
- A draft whose acceptance criteria span k module boundaries is emitted as k subspecs, each owning one
  boundary. Rules out capping at two children or leaving a remainder bundled.
- A drafted subspec whose acceptance criteria own a single module boundary is emitted unchanged.
  Rules out rewriting pass-through subspecs.
- Splitting leaves no provenance in durable spec text: no split-from lineage and no planning labels.
  Rules out planning-label residue in emitted subspecs.

## Acceptance criteria

- [ ] A drafted subspec whose acceptance criteria span two module boundaries is emitted as two
      subspecs, each owning one boundary; a fixture drives the plan step and fails against the
      pre-change emit-as-drafted path.
- [ ] A single-boundary drafted subspec is emitted unchanged; existing plan coverage stays green.
- [ ] No emitted subspec carries split provenance or a planning label.
- [ ] Inverting the boundary check turns the first test RED.

## Documentation updates

- `v2/docs/workflow-runner.md` — the plan step splits a multi-boundary drafted subspec rather than
  emitting it whole.
- `v1/docs/spec-guidance.md` — a subspec owns one module boundary (same surface definition as intent
  split).

## Prerequisites
