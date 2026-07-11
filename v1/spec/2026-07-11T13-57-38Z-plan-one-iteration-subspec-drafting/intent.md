---
name: plan-one-iteration-subspec-drafting
---

# Plan drafts one-iteration subspecs

## Problem

Plan drafts can combine independent code paths into a subspec that cannot complete in one normal patch iteration.

## Decisions

- Draft and review split independent code paths into independently testable subspecs rather than treating one precise monolith as higher quality.
- A subspec covers one implementation path and its focused verification rather than builder, runtime wiring, and validation together.
- Review must flag and split a subspec unlikely to finish in one normal patch iteration rather than merely compressing its prose.
- Deferred to first consumer: deterministic size thresholds — pin when a non-judgmental reviewer needs them.

## Documentation updates

- Update `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md` with the one-iteration subspec-sizing behavior.

## Out of scope

- Changing `iterationTimeoutMs`.

## Prerequisites
