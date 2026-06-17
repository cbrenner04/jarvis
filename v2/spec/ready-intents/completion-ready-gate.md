---
name: completion-ready-gate
---

**Scope.** This intent lives under `v2/spec/` for plan-mode routing only.
Implementation is v1 harness work — `v1/src/modes/patch/run.ts` (completion
transition) and `v1/docs/**`, `v2/docs/v1-behaviors.md`. Not v2/`v2/src`.

# Harness runs `bun run ready` at the completion transition

## Problem

The harness gauges completion by checkbox transitions and never runs `bun run
ready` during the implementation loop. An agent can tick every acceptance
criterion while the branch is red (commonly a Biome lint/format nit that `bun
test` + `bun run typecheck` miss). The first re-run of the suite is a
post-completion gate, so verification is deferred past the moment completion is
accepted.

## Desired behavior

At the completion transition (the tick that empties the active subspec's
checklist), the harness runs `bun run ready` once, harness-side wall-clock (zero
agent tokens). Green: proceed to the post-completion phases (shrink → review →
`maybeMarkReady`) exactly as today. The gate adds a green precondition on the
final transition; it does not change how completion is otherwise measured (still
checkbox transitions) and does not auto-tick or judge acceptance-criteria
content.

This intent covers the green path only: red handling (loop-back, stop reason) is
a separate behavior. On red here, preserve the pre-existing post-completion
behavior so this slice ships independently without a red regression.

## Decisions

- Harness runs `ready`, not the agent — keeps verification off the token budget.
  Rules out pushing `bun run ready` per-iteration onto the agent.
- Reuse `runReadyAndCommit` capture (`ready-gate.ts`) — rules out a second
  bespoke ready runner.

## Documentation updates

- `v1/docs/run-loop.md`: the completion `ready` gate and that green proceeds to
  the post-completion phases.
- `v2/docs/v1-behaviors.md`: completion gate behavior (changed completion path).

## Prerequisites
