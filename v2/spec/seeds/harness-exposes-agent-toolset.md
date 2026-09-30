---
name: harness-exposes-agent-toolset
---

# The harness exposes its own toolset to agents

> **Not dispatchable.** Very large addition (near a new engine generation). Stays a seed until the owner gives explicit sign-off. Do not run intent/plan/pipeline on it.

## Problem

Agents act on the worktree only through each vendor CLI's built-in tools (shell, file edit, search). Those tools are invisible to the harness: it cannot bound, attribute, audit, gate, or reap what they do, and every contract (gate slots, scope fences, ticking criteria, blockers, tokens) is enforced by prompt text and after-the-fact checks rather than at the tool boundary.

Evidence (2026-09-29): cursor-agent's shell wrapper (`/bin/bash -O extglob -c snap=$(command cat <&3) … dump_bash_state >&4`) repeatedly hung spinning ~90% CPU for 10–15 min on trivial commands, 7–12 at once across cursor lanes (load 30–46); coincident strands: three `iteration_timeout`, a SIGTERM mid-`test:v2`, a review `role_stalled`. Only an operator `kill` cleared them. Separately, ready-gate repair edited files outside its lane's scope (the git-2.56 fix re-implemented in-lane), caught only after the fact.

## Direction (proposed, pending sign-off)

- Jarvis defines one toolset (shell, read/write/edit, search, gate run, criterion tick, blocker, terminal token, …) and serves it to every agent (e.g. an MCP server per run); vendor built-ins are disabled where the CLI allows.
- Tool calls run in the run's worktree under recorded process groups with wall-clock/CPU/idle bounds and telemetry rows; gate commands take the gate-slot lease; writes outside the run's scope are refused at the call.
- Harness mechanics now carried by prompt rules move into tools (tick, blocker, token), so contracts are enforced where the action happens.

## Open questions for sign-off

- Which vendors can have native tools disabled; fallback for those that cannot.
- Transport (MCP vs adapter hooks) and the first slice (one tool, one vendor, end to end?).
- Which prompt-rule mechanics move into tools first.

## Acceptance criteria

- [ ] To be written after sign-off.

## Documentation updates

- To be decided after sign-off.
