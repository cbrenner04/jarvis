---
name: implement-run-records-agent-process-groups
---

# Implement iterations record agent process groups on the run row

## Problem

Only verifier spawns record process groups on the run row. The agent group and shell-tool descendant groups are invisible to `jarvis run kill` and daemon orphan sweep.

## Behavior

During an implement iteration, bind the existing run-row verifier process-group recorder to agent invocation via shared spawn/snapshot hooks: record the agent pgid at spawn and each snapshotted descendant pgid when abort/stall/timeout takes a snapshot; clear each id on settle. Reuse `storeVerifierProcessGroupRecorder` and the shared `isForeignProcessGroup` — no new persistence shape.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts`: an implement iteration records the agent pgid on the run row (`store.verifierProcessGroups(runId)`) while running and clears it on settle; fails against pre-fix (empty).
- [x] `v2/src/execution/write-loop.test.ts`: after a snapshotted descendant group exists (abort/stall/timeout snapshot path), that foreign pgid is recorded on the run row and cleared on settle; fails against pre-fix (agent pgid only or empty).
- [x] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — run rows record the agent group and snapshotted descendant groups for kill and sweep, same as verifier groups.

## Primary implementation surface

shared/invocation/agents.ts, v2/src/execution/write-loop.ts

## Prerequisites

- On abort, idle stall, and iteration timeout, agent invocation snapshots descendant process groups, SIGTERM-signs each foreign group plus the agent group, and escalates SIGKILL after the abort grace without cancelling escalation at settle.
