# Checkpoint a quiesced slot-refused iteration

## Problem

`awaitIteration` already waits for the raced-away invocation to quiesce and hands the outcome to the `gate_invocation_refused` settlement, but `finishGateInvocationRefused` commits the refusal boundary without checkpointing it. A slot-refused implement lane therefore loses its completed edits from the committed history: the work survives only as uncommitted worktree state and is re-paid for on resume. Abort and watchdog losses already avoid this through `checkpointBeforeControlledLoss`.

## Prerequisites

Subspec 00 (refusal cause available at the settlement seam).

## Decisions

- Checkpoint only when the refusal cause is `slot_contention` and the quiesced outcome settled with a real step result; a ceiling-headroom refusal keeps its current abort-before-boundary settlement, because its iteration was cut short precisely to avoid spending the ceiling.
- Route the checkpoint through `checkpointBeforeControlledLoss` (the existing controlled-loss seam), including its killed-run and `iteration_commit_failed` handling; rules out a bespoke commit path next to the refusal boundary.
- Checkpoint before `commitCompletionBoundary`, so the retained branch is ahead of its base whenever `boundary_committed` appends.
- Preserve immediate invocation abort after the shell command is announced, and preserve owned-lease acquisition and release semantics.

## Acceptance criteria

- [ ] A git-backed write-loop test drives a slot-refused lane whose invocation quiesced with edits and asserts the retained branch is ahead of its base with those edits committed before `boundary_committed` appends; it fails against the pre-fix abort-before-checkpoint path.
- [ ] A checkpoint failure on a slot-refused iteration settles through the same `iteration_commit_failed` path as other controlled losses.
- [ ] A ceiling-headroom refusal commits no checkpoint before its boundary.
- [ ] Existing owned-lease and ceiling-headroom refusal tests in `v2/src/execution/write-loop.test.ts` stay green (abort timing and lease release unchanged).
- [ ] `v2/docs/write-behavior.md` documents slot-refusal checkpoint ordering relative to the refusal boundary.
- [ ] `v2/docs/v1-behaviors.md` records the changed v2 slot-refusal durability behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — slot-refusal checkpoint ordering.
- `v2/docs/v1-behaviors.md` — v2 slot-refused iterations retain committed work.
