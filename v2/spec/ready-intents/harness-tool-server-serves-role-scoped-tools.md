---
name: harness-tool-server-serves-role-scoped-tools
---

# Each run serves a role-scoped Jarvis toolset to its agent

> Hold: owner sign-off required before `plan`; the seed was marked not dispatchable and this split records the proposed direction only.

## Problem

Agents act on the worktree only through each vendor CLI's native tools; Jarvis has no common tool boundary that can admit, scope, attribute, bound, or reject an operation (`shared/invocation/agents.ts` launches vendors with their defaults). Contracts such as scope fences and commit ownership rely on prompt text and after-the-fact checks.

## Decisions

- Tools are thin adapters over canonical operations, not separate implementations; CLI commands, scripts, and agent tools need not expose the same abstraction or permissions.
- Each run serves a role- and task-specific subset of Jarvis tools to its agent; nothing exposes every internal function or operator command automatically.
- Tool calls run in the run's worktree under recorded process groups (`verifier-process-groups.ts` pattern) with wall-clock, CPU, and idle bounds, and each call writes a telemetry row.
- Plan must decide the transport (MCP server per run vs adapter hooks) and the first slice (one tool, one vendor, end to end).

## Prerequisites

- Canonical operation owners exist for the operations tools wrap (delivered by: shared-git-operations-boundary)

## Acceptance criteria

- [ ] `tool-server.test.ts`: a run's agent connection sees only the tools its role is served; a call outside that subset is refused by name; fails against current code (no server).
- [ ] Same file: a tool call records its process group and a telemetry row, and a call exceeding its bound is killed and reported.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — tool adapters over canonical operations, role scoping, process lifecycle.

## Primary implementation surface

- `v2/src/execution/tool-server.ts` (new)
