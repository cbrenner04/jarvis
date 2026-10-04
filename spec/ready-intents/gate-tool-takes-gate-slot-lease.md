---
name: gate-tool-takes-gate-slot-lease
---

# Gate execution through the toolset takes the gate-slot lease

> Hold: owner sign-off required before `plan`; the seed was marked not dispatchable and this split records the proposed direction only.

## Problem

Agents run gates (`bun run test:agent`, `bun run check`) from an unrestricted vendor shell, outside the gate-slot lease (`gate-invocation-lease.ts`) and process-group supervision the harness applies to its own gate runs, so concurrent agent gates overload the machine and fake failures.

## Decisions

- A gate tool runs the named gate command under the gate-slot lease, in the run's worktree, under a recorded process group with bounds and a telemetry row; the agent cannot run gates any other way once native shell is disabled.
- Plan must decide which gates are exposed first and how the suite cap (#4407) composes with the lease.

## Prerequisites

- A tool server dispatches tool calls for the run (delivered by: harness-tool-server-serves-role-scoped-tools)
- Gate-slot lease exists for harness gate runs (already true: `src/execution/gate-invocation-lease.ts`)

## Acceptance criteria

- [ ] `gate-tool.test.ts`: a gate call waits for the lease, runs under a recorded process group, and returns exit code and bounded output; two concurrent gate calls serialize; fails against current code.
- [ ] `bun run typecheck` and `bun run test:agent` pass.

## Documentation updates

- `docs/operator-runbook.md` — gate execution via the tool and lease behavior.

## Primary implementation surface

- `src/execution/gate-tool.ts` (new), `src/execution/gate-invocation-lease.ts`
