---
name: harness-owned-agent-shell-tool
---

# Agents run shell commands through a harness-owned tool

> **Not dispatchable.** Large addition; stays a seed until the owner gives explicit sign-off. Do not run intent/plan/pipeline on it.

## Problem

Every agent CLI executes shell commands through its own vendor tool, outside the harness's view. Jarvis cannot bound, attribute, or reap those processes, and cannot see them in telemetry.

Evidence (2026-09-29): cursor-agent's shell wrapper (`/bin/bash -O extglob -c snap=$(command cat <&3) … dump_bash_state >&4`) repeatedly hung spinning ~90% CPU in userland for 10–15 min each while the wrapped command (e.g. `git diff … | rg …`) had finished or slept; 7–12 concurrent across 3–4 cursor lanes (load 30–46). Coincident strands: three `iteration_timeout`s, a SIGTERM (exit 143) mid-`test:v2`, a review `role_stalled`. The processes are the agent's, so no jarvis watchdog, verifier-group reaper, or `run kill` sees them; operator kills were the only recourse.

## Decisions (proposed, pending sign-off)

- The harness exposes one shell-execution tool to every agent (e.g. MCP or adapter-native tool hook) and disables or denies the vendor's built-in shell where the CLI allows it. Rules out per-vendor process scraping.
- Harness-run commands execute in the run's worktree under a recorded process group, with a per-command wall clock and CPU/idle bound, captured output, and telemetry rows (command, duration, exit).
- Gate-class commands (`bun run test*`, `bun run ready`) route through the existing gate-slot lease instead of relying on prompt rules.
- Kill, reap, and daemon-bounce paths cover these groups like verifier groups today.

## Open questions for sign-off

- Which vendors can have their native shell disabled, and what is the fallback for those that cannot?
- Tool transport: MCP server per run vs adapter-specific hook.
- Scope of the first slice (one vendor end to end vs contract first).

## Acceptance criteria

- [ ] To be written after sign-off.

## Documentation updates

- To be decided after sign-off (`shared-invocation.md`, `agent-model-config.md`, `operator-runbook.md` likely).
