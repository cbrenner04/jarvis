---
name: plan-split-index-orders-by-dependency
---

# Plan split orders emitted subspecs by dependency in the index

## Problem

Declared implement-before edges in an oversized draft can be inverted when split siblings are
emitted in canonical surface order, forcing the implement lane to consume subspecs out of runnable
order.

## Decisions

- When the oversized draft declares cross-boundary implement-before edges, emitted split subspecs
  follow that dependency order and `index.md` link order matches that sequence — rules out inverting
  stated edges.
- When no cross-boundary ordering signal is declared, `MODULE_BOUNDARY_SURFACES` array order
  remains acceptable — rules out reordering undeclared independent peers.
- Dependency order comes from explicit ordering or prerequisite signals in `## Decisions`, `## Tasks`,
  or `## Prerequisites` — rules out the plan step inventing order with no draft signal and rules out
  ignoring declared implement-before edges.

## Acceptance criteria

- [ ] When a drafted subspec splits into multiple subspecs, the emitted `index.md` lists them in
      draft-declared dependency order; fixture `k4` drives the plan step and fails when order
      inverts a declared dependency in the draft.
- [ ] Inverting dependency-order enforcement turns the fixture `k4` test RED.

## Documentation updates

- `v2/docs/workflow-runner.md` — split subspecs are index-ordered for implement consumption.
- `v2/docs/v1-behaviors.md` — boundary-split normalization emits siblings in draft-declared
  dependency order.

## Prerequisites

- The plan step replaces a multi-boundary drafted subspec with multiple emitted subspecs, each owning one module boundary
