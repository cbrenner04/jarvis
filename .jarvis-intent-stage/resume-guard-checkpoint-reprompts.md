---
name: resume-guard-checkpoint-reprompts
---

# Resume Guard Checkpoint Reprompts

## Prerequisites

- Implement write completion reprompts an otherwise-pure set of unlinked or hollow guard checkpoints, optionally with an unlinked keystone, within the shared `maxIterations` budget.
- Run logs persist one structured guard-checkpoint reprompt event with every criterion, resolved pin path, and unlinked-or-hollow reason in the ordered stream alongside existing directive-reprompt events.

## Surface

Daemon.

## Problem

Daemon resume currently reconstructs mutation-directive and keystone-directive reprompts only, so a paused guard-checkpoint repair would lose its process-local prompt context.

## Behavior

- Reconstruct the newest mutation-directive, guard-checkpoint, or keystone-directive reprompt context from the durable log tail when resuming a paused implement write.
- Pass every restored guard finding and its reason into the resumed write loop so the next iteration renders the same repair instructions.
- Restore only the chronologically newest directive-reprompt context; do not resurrect superseded sibling contexts.

## Decisions

- Resume replays durable context without resetting the write loop's consumed-iteration count; rules out granting a fresh guard-repair budget.
- Latest-event precedence spans all three directive-reprompt kinds; rules out independent scans that revive stale contexts.

## Required verification

- A daemon resume test restores multiple unlinked and hollow guard findings with their criterion text and resolved pin paths.
- Resume precedence tests cover a guard event superseding each existing directive-reprompt kind and each existing kind superseding a guard event.
- Existing mutation-directive and keystone-directive resume tests remain green.

## Documentation updates

- `v2/docs/write-behavior.md` — pause/resume replay for guard-checkpoint repair and shared-budget continuity.
- `v2/docs/v1-behaviors.md` — daemon resume restores only the latest directive-reprompt context, including guards.
