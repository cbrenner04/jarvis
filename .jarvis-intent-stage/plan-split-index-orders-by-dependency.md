---
name: plan-split-index-orders-by-dependency
---

# Plan split orders emitted subspecs by dependency in the index

## Problem

Peer split subspecs with hidden dependencies force the implement lane to consume them out of runnable
order.

## Decisions

- Emitted split subspecs are ordered by dependency; `index.md` link order matches that sequence.
  Rules out emitting independent peers when one must land before the other.

## Acceptance criteria

- [ ] When a drafted subspec splits into multiple subspecs, the emitted `index.md` lists them in
      dependency order; a fixture drives the plan step and fails when order inverts a declared
      dependency.

## Documentation updates

- `v2/docs/workflow-runner.md` — split subspecs are index-ordered for implement consumption.

## Prerequisites

- The plan step replaces a multi-boundary drafted subspec with multiple emitted subspecs, each owning one module boundary
