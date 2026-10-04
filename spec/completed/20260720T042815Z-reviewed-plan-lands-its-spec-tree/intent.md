---
name: reviewed-plan-lands-its-spec-tree
---

# A reviewed plan run lands its spec tree instead of stranding a staged `.jarvis-plan-stage/`

`jarvis run workflow plan --review-passes 1 --review-behavior light` publishes a PR containing
only `.jarvis-plan-stage/` and no spec dir, while plain `jarvis run workflow plan` lands the same
intent correctly. Review defers the landing, but the review step's resumption hook is hardcoded to
the `intent-stage` kind, so a deferred `plan-tree` landing has no resumption path and its staged
tree is dropped.

## Behavior

Make landing resumption polymorphic over `PublicationLanding`, mirroring `landPublication` itself.
The review step resumes whatever landing it deferred through the existing generic dispatch rather
than a per-kind hook, so a reviewed plan run consumes its stage and produces its `v2/spec/...` tree
exactly as the plain path does. Verdict-file handling (exclude verdict from staging, restore on
failure) applies to every reviewed landing kind, not just intent.

Regression coverage asserts a reviewed **plan** run lands its spec tree and consumes its stage —
the assertion that would have caught this gap.

## Out of scope

- The false `killed` rollup on the same runs (`a-non-durable-review-step-rolls-up-as-killed`).
- Whether the generic review step should be durable (`review-step-emits-log-events`).

## Prerequisites
