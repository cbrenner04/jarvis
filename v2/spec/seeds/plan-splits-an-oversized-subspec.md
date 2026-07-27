---
name: plan-splits-an-oversized-subspec
---

# Plan splits an oversized subspec instead of emitting it

## Problem

The plan step emits whatever subspecs its draft produced. When one subspec carries several
independent surfaces, the implement run that consumes it has a blast radius no repair budget can
absorb — and the operator only finds out after a failed run.

There is no operator action worth adding here: a refusal would just hand the split back to a human.
The plan step already knows how to author multiple subspecs, so the correction is for it to split
the oversized one itself and continue.

## Evidence (2026-07-27)

`implement-repairs-ticked-surviving-mutation-run` planned into two subspecs of 157 and 125 lines,
against a session-wide norm of 28–36. Its first implement lost 753 uncommitted lines to an idle
timeout mid-write-step; its second reddened ~10 workflow-dispatch tests at once and spent its repair
budget on breadth. Every subspec at the 28–36 norm landed on its first implement.

## Decisions

- When a drafted subspec spans more than one surface, the plan step splits it into further subspecs
  and emits the split result. Rules out refusing, warning, or emitting it with a note — none of those
  fix the artifact, and all of them cost an operator round trip.
- The split preserves every decision and acceptance criterion, distributed to the subspec that owns
  it. Rules out re-deriving criteria, which is where meaning gets lost.
- Split subspecs are ordered by dependency and the index reflects that order, so the implement lane
  consumes them in a runnable sequence. Rules out emitting peers that cannot be implemented
  independently.
- The size signal is structural — a subspec whose acceptance criteria own more than one module
  boundary. Rules out a line-count threshold, and rules out putting any number in the prompt.
- Splitting is silent in the artifact: no "split from" provenance in the subspec text. Rules out
  planning-label residue in durable specs.

## Acceptance criteria

- [ ] A drafted subspec spanning two module boundaries is emitted as two subspecs, each owning its
      boundary; a fixture drives the plan step and fails against the pre-change emit-as-drafted path.
- [ ] Every decision and acceptance criterion from the drafted subspec appears in exactly one emitted
      subspec; none is dropped or duplicated.
- [ ] The emitted index orders split subspecs by dependency.
- [ ] A single-boundary subspec is emitted unchanged; existing plan coverage stays green.
- [ ] No emitted subspec carries split provenance or a planning label.
- [ ] Inverting the boundary check turns the first test RED.

## Documentation updates

- `v2/docs/workflow-runner.md` — the plan step splits an oversized subspec rather than emitting it.
- `v1/docs/spec-guidance.md` — a subspec owns one module boundary.
