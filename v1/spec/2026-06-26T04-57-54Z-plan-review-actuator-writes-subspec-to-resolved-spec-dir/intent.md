---
name: plan-review-actuator-writes-subspec-to-resolved-spec-dir
---

# Plan review actuator overwrites the draft subspec in place under targetDir

## Problem

In a single-subspec plan, the review actuator wrote the refined subspec to the
repo root (`<root>/<timestamp>-<name>/00-*.md`) instead of overwriting the draft
under `<targetDir>/<timestamp>-<name>/00-*.md`. The spec dir kept the
verdict-rejected `plan: draft` version; the refined `plan: review: actuator`
version landed at a stray top-level path the index never references, so a later
`jarvis run` silently read the pre-refinement draft. Observed 2026-06-25 on
PR #549 (hand-recovered).

## Direction

The review actuator must write refined subspec files to the same path the draft
wrote — the resolved spec dir inside `targetDir`, with the full
`targetDir`/spec-dir prefix — overwriting the existing subspec in place. Add a
plan-side guard/test that a review pass overwrites the draft subspec at its
original path and emits no spec file outside the resolved spec dir.

## Out of scope

- The non-contract `index.md` line stripping (shipped separately).

## References

- Plan review actuator path resolution: `v1/src/modes/plan/`.
- Observed 2026-06-25 (PR #549 hand-fix).

## Prerequisites

- Plan mode runs a review pass (review actuator) that refines draft subspecs.
- Draft subspecs are written under the resolved spec dir inside targetDir.
