---
name: plan-review-actuator-writes-subspec-to-repo-root
---

# plan review actuator writes the refined subspec to the repo root (loses targetDir prefix)

## Problem

In a single-subspec plan, the **review actuator** wrote the refined subspec to
the **repo root** (`<root>/<timestamp>-<name>/00-*.md`) instead of overwriting
the draft under `v1/spec/<timestamp>-<name>/00-*.md`. Result: the spec dir under
`v1/spec/` kept the un-refined `plan: draft` version (the one the verdict
**rejected**), while the corrected `plan: review: actuator` version landed at a
stray top-level path the index never references.

Net: the spec a later `jarvis run` reads (`v1/spec/.../00-*.md`, the path the
`index.md` checklist points at) is the pre-refinement, verdict-rejected draft —
the refinement is silently lost to a stray root dir. Confirmed via git history
on the worktree (`git log` showed the root file authored by `plan: review:
actuator`, the v1/spec file by `plan: draft`).

Observed 2026-06-25 on the `intent-generated-ready-intents-pass-lint-md` plan
(PR #549); hand-recovered by promoting the root content to the correct path and
deleting the stray dir.

## Direction

The review actuator must write refined subspec files to the **same path the
draft wrote** (under the resolved spec dir inside `targetDir`), not a path
missing the `targetDir`/spec-dir prefix. Add a plan-side guard/test that a
review pass overwrites the existing subspec in place and that no spec file is
emitted outside the spec dir.

## Out of scope

- The non-contract `index.md` line stripping (shipped separately).

## References

- Plan review actuator path resolution: `v1/src/modes/plan/`.
- Observed 2026-06-25 (PR #549 hand-fix).
