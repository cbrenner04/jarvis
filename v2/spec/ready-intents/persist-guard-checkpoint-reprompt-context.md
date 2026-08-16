---
name: persist-guard-checkpoint-reprompt-context
---

# Persist Guard Checkpoint Reprompt Context

## Prerequisites

- Implement write completion reprompts an otherwise-pure set of unlinked or hollow guard checkpoints, optionally with an unlinked keystone, within the shared `maxIterations` budget.

## Surface

Persistence.

## Problem

Guard-checkpoint repair instructions need durable structured evidence so a paused run can recover every criterion, pin, and reason instead of depending on process-local write-loop state.

## Behavior

- Persist one guard-checkpoint reprompt event containing every eligible finding's criterion, resolved repo-relative pin path, and unlinked-or-hollow reason.
- Include the event in the durable run-log contract without changing existing mutation-directive or keystone-directive event payloads.
- Preserve guard events in the ordered run-log stream alongside existing mutation-directive and keystone-directive reprompt events.

## Decisions

- One event stores the complete eligible finding set; rules out partial replay from one event per guard.
- Persist structured reason data, not prompt-rendered prose; rules out coupling resume compatibility to prompt wording.
- Existing reprompt event shapes remain readable; rules out rewriting historical log records.

## Required verification

- Log-stream tests pin the multi-finding guard event shape, unlinked-versus-hollow reason distinction, and ordering alongside existing directive-reprompt events.

## Documentation updates

- `v2/docs/write-behavior.md` — canonical durable guard-reprompt event contract, including its findings, reasons, and stream ordering.
- `v2/docs/v1-behaviors.md` — parity-catalog entry that links to the canonical contract and records preserved existing-event compatibility.
