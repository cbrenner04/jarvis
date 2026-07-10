# Surface checkpointed partial progress in the next prompt

## Problem

An iteration-timeout can checkpoint partial edits, but the next implementation prompt looks like a fresh attempt. The next agent may redo the same work instead of continuing the checkpoint.

## Decisions

- Add an optional timeout-checkpoint context to normal `buildPrompt` output; rules out changing every implementation prompt.
- Emit the context only when the active subspec's preceding attempt ended in iteration-timeout and its WIP checkpoint is present; rules out treating idle/run timeouts or ordinary WIP commits as resumable timeout checkpoints.
- Tell the next agent to inspect and continue the existing partial implementation; rules out merely naming the checkpoint without changing agent direction.
- Keep prompt output byte-for-byte unchanged when timeout-checkpoint context is absent; rules out an empty heading or generic resume prose on fresh/non-timeout attempts.
- Govern the optional wording and placeholder through `patch.prompt.body`, including its revision and rendered fixtures; rules out runtime-only prompt prose outside the registry contract.

## Tasks

- Detect the prior iteration-timeout WIP checkpoint for the still-active subspec and pass optional partial-progress context into normal implementation prompt construction.
- Extend `buildPrompt` and `patch.prompt.body` with an optional delimited context section that is removed when absent.
- Add prompt and run-loop coverage for timeout-checkpoint continuation and non-timeout prompt stability.
- Bump the prompt revision and regenerate affected shared and Codex-wrapper fixtures.
- Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md` with the prompt-conditioning behavior.
- Run `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] After an active subspec iteration times out and Jarvis creates its `WIP: checkpoint (iteration-timeout)` commit, the next implementation prompt tells the agent that partial implementation is already present and to inspect and continue it.
- [ ] Idle timeout, run timeout, non-timeout failure, and runs without a timeout checkpoint retain the existing implementation prompt content.
- [ ] Timeout-checkpoint context applies only to the still-active subspec's normal implementation prompt; fix-up, shrink, and review prompts remain unchanged.
- [ ] `patch.prompt.body`'s revision-aware shared and Codex-wrapper snapshots cover the optional prompt contract.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/run-loop.md`: document that a resumed normal implementation prompt identifies checkpointed partial work after iteration-timeout.
- `v2/docs/v1-behaviors.md`: record the v1 prompt-conditioning behavior and source paths.

## Out of scope

- Creating the timeout checkpoint commit.
- Repeated-timeout detection or signaling.
