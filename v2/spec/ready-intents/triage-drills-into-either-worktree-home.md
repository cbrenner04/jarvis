---
name: triage-drills-into-either-worktree-home
---

# Triage drills into either worktree home

## Behavior

`jarvis1 triage <name>` resolves worktrees in `<repo>/.worktree/` and the registered project's Jarvis-owned v2 home, then renders the existing diagnostic sections for either home.

A name present in both homes is refused with both matching paths instead of selecting one.

## Decisions

- Use one two-home named resolver; rules out home-specific drill-down commands.
- Refuse cross-home ambiguity; rules out resolution by search order.

## Documentation updates

- `v1/docs/operator-runbook.md`: record two-home drill-down and ambiguity refusal.
- `v2/docs/v1-behaviors.md`: record named resolution across both homes.

## Prerequisites

- Registered projects have a Jarvis-owned worktree home discoverable from project configuration.
