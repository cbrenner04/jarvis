---
name: workflow-terminal-waits-for-all-rows
---

# Workflow terminal evidence waits for every row

## Problem

The invocation finally path writes a settled marker even while a linked row remains non-terminal, producing a false finished incident.

## Decisions

- Write settled markers only when every durable row of the invocation is terminal; paused rows remain resumable and cannot certify completion. Apply the same guard to terminal incident resolution.

## Prerequisites

none

## Documentation updates

- v2/docs/daemon-host.md and v2/docs/v1-behaviors.md state the all-row terminal boundary.
