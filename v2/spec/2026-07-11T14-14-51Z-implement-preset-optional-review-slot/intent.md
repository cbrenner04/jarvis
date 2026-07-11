---
name: implement-preset-optional-review-slot
---

# Permit an optional implement review slot

The `implement` preset validates either its current write-only workflow or one additional step, so a later review behavior can compose with it.

## Decisions

- Accept one or two implement preset steps, not exactly one; rules out blocking a later review step at preset validation.
- Do not add review behavior here; rules out inventing review semantics before its first consumer.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with the implement preset's permitted step counts.

## Acceptance criteria

- [ ] The implement preset accepts both write-only and one-additional-step workflow shapes.
- [ ] Other preset cardinality validation remains unchanged.
- [ ] Workflow preset tests cover both accepted implement shapes and rejected counts.

## Prerequisites

- The `implement` preset exists.
