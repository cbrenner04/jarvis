---
name: harness-exposes-agent-toolset
---

# The harness exposes its own toolset to agents

> **Not dispatchable.** Very large addition (near a new engine generation). Stays a seed until the owner gives explicit sign-off. Do not run intent/plan/pipeline on it.

## Problem

Agents act on the worktree through each vendor CLI's built-in tools (shell, file edit, search). Jarvis has some shell-event observation, process supervision, and result checks, but no common tool boundary that can admit, scope, attribute, bound, or reject every operation. Contracts such as scope fences and commit ownership rely on prompt text and checks after execution.

Evidence (2026-09-29): cursor-agent's shell wrapper (`/bin/bash -O extglob -c snap=$(command cat <&3) … dump_bash_state >&4`) repeatedly hung spinning ~90% CPU for 10–15 min on trivial commands, 7–12 at once across cursor lanes (load 30–46); coincident strands: three `iteration_timeout`, a SIGTERM mid-`test:v2`, a review `role_stalled`. Only an operator `kill` cleared them. Separately, ready-gate repair edited files outside its lane's scope (the git-2.56 fix re-implemented in-lane), caught only after the fact.

## Prerequisites

- [Centralize deterministic operations](./centralize-deterministic-operations.md) — establish canonical operation owners across runtime code and scripts before exposing them as tools.

## Direction (proposed, pending sign-off)

- Tools are thin adapters over canonical operations, not separate implementations. Higher-level commands compose lower-level operations; CLI commands, scripts, and agent tools need not expose the same abstraction or permissions.
- Jarvis defines tools for scoped read/write/edit, search, Git queries, gate execution, criterion tick, blocker, terminal token, and other approved operations, and serves a role/task-specific subset to each agent (e.g. an MCP server per run). Do not automatically expose every internal function or operator command.
- Tighten launch settings from today's vendor-specific defaults: disable native tools where supported, expose only authorized Jarvis tools, and retain underlying filesystem/process sandboxing. No silent fallback to broader access when a vendor cannot enforce the required restrictions; decide whether it is eligible for the role.
- Tool calls run in the run's worktree under recorded process groups with wall-clock/CPU/idle bounds and telemetry rows; gate commands take the gate-slot lease; writes outside the run's scope are refused at the call.
- Harness mechanics now carried by prompt rules move into tools (tick, blocker, token), so contracts are enforced where the action happens.
- Keep commit/publication ownership in the harness. A tool's presence does not authorize arbitrary Git mutations; authorization derives from the role and active task and is checked at execution.
- Design shell access explicitly. An unrestricted Jarvis shell still permits direct Git commands, scripts invoking Git, and direct `.git` writes; moving the shell behind MCP alone does not enforce the canonical boundary. Command-name blocklists are insufficient. Decide how tests/debugging remain available without bypassing denied operations, including subprocesses of allowed commands.
- [Free-text command routing](./free-text-command-routing.md) is a separate high-level interface to canonical services. Its translating agent has no execution tools and cannot inherit coding-agent capabilities.

## Open questions for sign-off

- Which vendors can disable native tools and enforce role-specific capabilities; eligibility for those that cannot.
- Shell/test/debugging capabilities and filesystem/process restrictions needed to prevent indirect Git or scope bypasses.
- Transport (MCP vs adapter hooks) and the first slice (one tool, one vendor, end to end?).
- Which prompt-rule mechanics move into tools first.

## Acceptance criteria

- [ ] To be written after sign-off.

## Documentation updates

- `v2/docs/v2-architecture.md` — tool adapters, canonical operation ownership, authorization, and process lifecycle.
- `v2/docs/agent-model-config.md` — vendor capability requirements and tightened launch settings.
- `v2/docs/write-behavior.md` — mechanics enforced at the tool boundary and remaining prompt obligations.
