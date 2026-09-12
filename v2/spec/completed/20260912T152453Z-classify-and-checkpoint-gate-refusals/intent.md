---
name: classify-and-checkpoint-gate-refusals
---

# Classify gate refusals and checkpoint slot-refused work

## Prerequisites

## Module-boundary surface

- Execution loop: gate admission settlement and per-iteration checkpointing.

## Problem

The write loop collapses ceiling-headroom and occupied-slot refusals into one abort path. That path commits the refusal boundary without checkpointing the quiesced invocation result, so a slot-refused implement lane can retain complete edits only as uncommitted work and repay for them on resume.

## Behavior

- The write loop distinguishes slot contention from ceiling-headroom refusal at the refusal site and checkpoints a quiesced slot-refused iteration before committing its refusal boundary.

## Decisions

- Classify the refusal where the headroom check or lease acquisition fails; rules out inferring cause later from timing or logs.
- Route a quiesced slot refusal through the ordinary controlled-loss checkpoint seam before its SQLite boundary; rules out a special commit path.
- Preserve immediate invocation abort after the shell command is announced and preserve owned-lease acquisition and release semantics.
- Leave ceiling-headroom refusal settlement unchanged apart from carrying its explicit cause.

## Acceptance criteria

- [ ] A write-loop regression test proves slot and ceiling-headroom refusals return distinct causes; it fails against the pre-fix undifferentiated refusal.
- [ ] A git-backed write-loop test proves a slot-refused lane checkpoints its quiesced iteration changes before `boundary_committed`, leaving the retained branch ahead of its base; it fails against the pre-fix abort-before-checkpoint path.
- [ ] Existing owned lease and ceiling-headroom refusal tests in `v2/src/execution/write-loop.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — refusal cause classification and slot-refusal checkpoint ordering.
- `v2/docs/v1-behaviors.md` — record the changed v2 refusal settlement and durability behavior.
