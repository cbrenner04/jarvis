---
name: ready-gate-repair-event-gate-context
---

# `ready_gate_repair` log events carry failing step and bounded gate output

## Problem

`jarvis run log` records only `attempt` and `gateExitCode` on `ready_gate_repair`, so operators cannot see which gate step failed or what output the repair agent was given.

## Decisions

- Extend the `ready_gate_repair` event with `failingStep` (the `GATE_STEP` value) and `gateOutputTail` (last 4 KiB of the failing step output, same cap as `AUTOFIX_TYPECHECK_OUTPUT_TAIL_MAX`).
- Emit the fields from the write-loop ready-gate repair path; update assertions that pin the old event shape.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-ready-repair.test.ts` (new; `write-loop.test.ts` is over budget pending its split): the `ready_gate_repair` event carries `failingStep` and a `gateOutputTail` ending with the gate output's last line and capped at 4 KiB; fails against the pre-fix two-field event.
- [ ] `write-loop.test.ts` and `workflow-runner-publication.test.ts` `ready_gate_repair` shape pins updated for the new fields; fail against pre-fix two-field assertions.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § Ready gate repair — note `ready_gate_repair` includes `failingStep` and `gateOutputTail`.

## Primary implementation surface

v2/src/execution/write-loop.ts, v2/src/persistence/log-stream.ts

## Prerequisites

- When planned with `ready-repair-prompt-allowed-paths`, one spec with ordered subspecs sharing `write-loop-ready-repair.test.ts` avoids duplicate scaffolding.
