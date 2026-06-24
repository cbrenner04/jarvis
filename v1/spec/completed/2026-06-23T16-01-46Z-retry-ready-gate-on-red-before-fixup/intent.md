---
name: retry-ready-gate-on-red-before-fixup
---

# Retry the completion ready gate on red before entering the fix-up loop

## Problem

When the target repo's `readyCommand` flakes (passes in-worktree, fails under the full parallel
run), the post-completion gate reads the red as a real failure and immediately enters the fix-up
loop — burning iterations and editing correct work to chase a non-deterministic failure.

## Behavior

When the completion ready gate returns red, re-run it unchanged (no edits between runs) up to a
bounded number of times. Enter the fix-up loop only if the gate fails on every retry — i.e. fails
deterministically. If any retry passes, treat the gate as green and finalize completion normally.

This distinguishes a flaky gate from a real failure cheaply, before any contaminating fix-up edit.

## Out of scope

- Discarding fix-up commits once the loop has run (separate behavior).
- A per-project retry-count knob (separate behavior; this ships a sensible default).
- Stabilizing the target repo's own flaky tests.

## Prerequisites
