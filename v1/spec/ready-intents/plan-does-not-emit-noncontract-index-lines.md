---
name: plan-does-not-emit-noncontract-index-lines
---

# Plan-generated `index.md` carries only contract lines (title + subspec checklist)

## Problem

The plan actuator sometimes writes a non-contract `repo:` line into a
generated `index.md` (observed: `repo: https://github.com/cbrenner04/jarvis`,
`repo: cbrenner04/jarvis`). The index contract is H1 title plus subspec
checklist only; the stray line later breaks `jarvis run`.

## Behavior

The plan draft boundary check validates that a generated `index.md` contains
only contract content — H1 title and the subspec checklist — and either
strips or rejects a non-contract `repo:` (or other stray metadata) line so it
never reaches a merged spec. Legitimate index content is unaffected.

## Out of scope

- Run-side tolerance of an already-present stray line (separate behavior).
- The optional/required `repo:` binding for external no-commit specs, which
  live outside the target directory and legitimately carry `repo:`.

## References

- Plan draft validation: `validate*`/index checks in
  `v1/src/modes/plan/draft.ts`; index parsing in `v1/src/modes/plan/pr.ts`
  (`parseIndex`); index contract in `v1/docs/spec-guidance.md`.
- Observed 2026-06-25 (auth-error + dep-adding index.md; PR #522 hand-fix).

## Prerequisites
