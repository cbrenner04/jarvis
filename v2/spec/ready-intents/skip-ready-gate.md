---
name: skip-ready-gate
---

# Per-project opt-out of the completion ready gate

## Problem

A gateless repo (no verification command at all) cannot pass the completion ready gate no matter what
command it points at. Such repos need to opt out of the gate entirely, not just redirect it.

## Direction

Let a repo configure the completion ready gate to skip, reusing the gate-override config surface. When
skipped, no gate command runs at any call site (completion transition, pre-shrink, review
baseline/final, `maybeMarkReady`) and the `check:fix`/commit/push fix-up loop does not engage.
Opt-in, default-off; repos that set nothing keep `bun run ready`.

Skip relaxes the "ready means verified" invariant. For plan to decide deliberately and call out: does
a skipped gate still flip the PR to ready, or leave it draft? What replaces the fix-up loop's role?
Plus validation rules for the skip value.

## Out of scope

- Alternate gate command (separate behavior).
- Plan-mode gate behavior.
- Changing `bun run ready` for repos that set no override.

## References

- `v1/src/ready-gate.ts` — the gate.
- `v1/src/modes/patch/pr.ts` (`maybeMarkReady`), `completion-pipeline.ts`, `shrink.ts`, `review.ts` — call sites and PR-ready flip.
- `v1/src/config.ts` — config validation.

## Prerequisites
- A per-project config surface selecting how the completion ready gate runs exists.
