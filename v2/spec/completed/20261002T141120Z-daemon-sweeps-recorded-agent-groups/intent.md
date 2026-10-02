---
name: daemon-sweeps-recorded-agent-groups
---

# Daemon startup sweep signals recorded agent process groups

## Problem

After a dead daemon, a run row may still list process groups from a killed implement iteration. Operator expectation is that startup sweep reaches agent-recorded groups, not only ready-gate and verifier groups.

## Behavior

Confirm (and extend tests if needed) that `signalRecordedVerifierProcessGroups` / orphan ready-gate sweep already SIGTERM→SIGKILL every `store.verifierProcessGroups` id for dead-owner runs, including agent groups recorded by implement iterations. No parallel sweep path.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts`: a run row carrying a recorded agent group from a dead daemon is signalled at startup sweep; fails against pre-fix when agent groups are never recorded.
- [x] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — recorded process groups include the agent tree; a leaked `bun test` after iteration timeout is a bug, not expected.

## Primary implementation surface

v2/src/daemon/daemon.ts

## Prerequisites

- On abort, idle stall, and iteration timeout, agent invocation snapshots descendant process groups, SIGTERM-signs each foreign group plus the agent group, and escalates SIGKILL after the abort grace without cancelling escalation at settle.
- Implement iterations record the agent pgid and snapshotted descendant pgids on the run row via the verifier process-group recorder and clear them on settle.
