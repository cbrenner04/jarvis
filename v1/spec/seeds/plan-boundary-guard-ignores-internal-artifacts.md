---
name: plan-boundary-guard-ignores-internal-artifacts
---

# Plan write-boundary guard must ignore jarvis-internal artifacts

## Problem

The plan review-actuator write-boundary guard (shipped this session, the
`plan-review-actuator-writes-subspec-to-resolved-spec-dir` work) treats
**jarvis's own internal review scratch files** as out-of-bounds spec writes. A
plan pass reverted `.jarvis-review-plan-adversary-1` (an adversary-review marker
written at the worktree root), appended a `## Blocker`, and **failed the whole
plan** (`agent-error`). Observed 2026-06-26 on the
`plan-generated-spec-markdown-passes-lint-md` plan (failed both attempts).

The guard's intent is to catch the *actuator* writing **spec** files outside the
resolved spec dir — not to police jarvis's internal `.jarvis-*` artifacts, which
legitimately live outside the spec dir. As written it intermittently breaks any
plan whose review pass drops such a marker.

## Direction

Scope the boundary guard to spec output only: exclude jarvis-internal paths
(`.jarvis-*` review/markers and any other harness-managed scratch) from the
out-of-bounds detection so they are neither flagged nor reverted. Keep catching
genuine out-of-bounds **spec** writes. Add a regression test: an in-bounds spec
edit plus a `.jarvis-review-*` artifact at the worktree root passes the guard
(no revert, no blocker).

## Out of scope

- The guard's core revert/fail behavior for real out-of-bounds spec writes
  (correct — keep it).

## References

- Guard: `v1/src/modes/plan/` (boundary check on the actuator commit path,
  shipped this session).
- Observed 2026-06-26: `.jarvis-review-plan-adversary-1` reverted; plan failed.
