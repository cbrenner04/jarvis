---
name: extend-orphan-reaping-to-prompt-and-review
---

# Extend marker-based orphan reaping to prompt and review modes

**Scope.** `v1/src/modes/prompt/run.ts`, `v1/src/modes/patch/review.ts`, tests,
docs.

## Problem

Prompt mode and the review passes spawn agents through the same detached
process-group path that leaks re-parented orphans, but the marker-based reap is
wired only into the patch run loop. Forking reaping behavior per mode leaves
prompt and review runs able to leave PPID=1 orphans behind.

## Desired behavior

Prompt-mode invocations and review-pass invocations reap their agent's
descendants — including ones re-parented to init that escaped the process
group — when each invocation ends. Reaping is best-effort and does not change
prompt or review exit codes.

## Decisions

- Reuse the same marker-based reaping mechanism the patch loop uses; do not
  fork per-mode reaping behavior.
- Apply at the prompt-mode spawn path and the review-pass spawn path.
- Best-effort and non-fatal: reaping failures must not change exit codes.

## Acceptance signals

- A prompt-mode invocation whose agent left a re-parented orphan (PPID=1,
  carrying the invocation marker) reaps it when the invocation ends.
- A review-pass invocation reaps a re-parented orphan its agent left behind.
- Existing prompt and review tests still pass; exit codes unchanged.

## Documentation updates

- `v1/docs/run-loop.md`: note prompt and review invocations reap re-parented
  orphans like the patch loop.
- `v2/docs/v1-behaviors.md`: record prompt/review orphan reaping parity as
  current v1 behavior.

## Prerequisites
- Marker-based reaping of re-parented agent orphans at iteration end and finalize
