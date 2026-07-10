---
name: resume-continues-from-checkpointed-partial-progress
---

# Next iteration's prompt points the agent at checkpointed partial progress instead of a fresh start

Once a timed-out iteration's edits are committed as a WIP checkpoint, the next agent still
needs to be told a prior attempt left partial work in the worktree — otherwise it re-derives
the same wiring from scratch and re-hits the wall, defeating the point of checkpointing.

## Decisions

- When the previous iteration on the active subspec ended in an iteration-timeout with a WIP
  checkpoint present, `buildPrompt`'s extras include that context so the agent is told to
  continue the existing partial implementation — rules out a prompt that looks identical to a
  fresh-start iteration, which is what causes the re-do-from-scratch behavior.
- No change to prompt content when the prior iteration was not a timeout.

## Out of scope

- The checkpoint-commit mechanism itself (assumed present).
- Repeated-timeout detection/signal (separate intent).

## Documentation updates

- `v1/docs/run-loop.md`: note the prompt now surfaces prior-timeout partial-progress context.
- `v2/docs/v1-behaviors.md`: record this prompt-conditioning behavior.

## Prerequisites

- Iteration-timeout commits uncommitted agent edits as a WIP checkpoint before returning exit 8.
