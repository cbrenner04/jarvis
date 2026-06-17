---
name: completion-ready-gate
---

**Scope.** This intent lives under `v2/spec/` for plan-mode routing only.
Implementation is v1 harness work — `v1/src/modes/patch/run.ts` (completion
transition), `v1/src/modes/patch/shrink.ts` + `v1/src/modes/patch/review.ts` +
`v1/src/modes/patch/pr.ts` (post-completion ready gates), `v1/src/ready-gate.ts`,
`v1/docs/**`, `v2/docs/v1-behaviors.md`. Not v2/`v2/src`.

# Single `bun run ready` at completion, reused by the post-completion gates

## Problem

The harness gauges completion by checkbox transitions and never runs `bun run
ready` during the implementation loop, so verification is deferred until a
post-completion gate. Worse, more than one gate runs it independently: the
shrink pre-gate (`shrink.ts`), the review baseline gate (`review.ts`), and the
review-skipped `maybeMarkReady` (`pr.ts`) each call `runReadyAndCommit`. On the
common path (no-op shrink, unchanged tree) that is two full suite runs
back-to-back on the same commit for one completed spec — wall-clock spent
re-proving an already-green tree.

## Desired behavior

The harness runs `bun run ready` once at the completion transition (the tick
that empties the active subspec's checklist), harness-side wall-clock (zero
agent tokens), via the existing `runReadyAndCommit` path. On success it records
the green result keyed to the resulting tree state (HEAD sha + clean worktree).

The post-completion gates (shrink pre-gate, review baseline, `maybeMarkReady`)
stop running `ready` unconditionally: when the tree is unchanged since the
recorded green result they reuse it and skip their own run; only a changed tree
(e.g. a `shrink:` commit landed, or a `check:fix` commit) re-runs `ready`. Net
on the common path: one `ready` per completed spec instead of two-plus.

Green path only. This intent does not change red handling: when the
completion-transition `ready` is red, fall through to the pre-existing
post-completion behavior so the slice ships independently without a red
regression (red loop-back is a separate intent). It does not change how
completion is otherwise measured (still checkbox transitions) and does not
auto-tick or judge acceptance-criteria content.

## Decisions

- One harness-side `ready` at completion, reused downstream — rules out the
  current redundant per-gate re-runs on an unchanged tree, and rules out pushing
  `bun run ready` per-iteration onto the agent.
- Reuse is keyed on tree state (HEAD sha + clean worktree), not a bare boolean —
  rules out reusing a stale green result after shrink or a `check:fix` commit
  mutates the tree.
- Reuse the existing `runReadyAndCommit` / `ready-gate.ts` capture — rules out a
  second bespoke ready runner.
- Red at the completion gate preserves today's post-completion behavior — rules
  out coupling this slice to the red loop-back so it can land alone.

## Documentation updates

- `v1/docs/run-loop.md`: the single completion `ready` gate and the
  unchanged-tree reuse by the post-completion phases (replacing the per-gate
  re-run description).
- `v2/docs/v1-behaviors.md`: completion gate + gate-reuse behavior.

## Out of scope

- Red-completion loop-back and stop reason (separate intent).
- Making the agent run `bun run ready` per iteration.
- Shrink rollback-vs-preserve behavior (tracked separately).
- Auto-ticking or the harness judging acceptance-criteria content.

## Prerequisites

- None — this is the base slice; the red loop-back intent depends on it.
