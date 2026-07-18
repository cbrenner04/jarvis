---
name: triage-lists-both-worktree-homes
---

# Triage lists both worktree homes

## Behavior

No-argument `jarvis1 triage` lists worktrees from `<repo>/.worktree/` and the registered project's Jarvis-owned v2 home. Every row identifies its home and retains the existing dirty, ahead/behind, PR, spec-progress, landed, and draft classification.

## Decisions

- Present both homes in one table; rules out a separate v2 listing command.
- Name the home on every row; rules out indistinguishable same-name worktrees.

## Documentation updates

- `v1/docs/operator-runbook.md`: record that triage listing covers both homes and identifies each row's home.
- `v2/docs/v1-behaviors.md`: record two-home listing and unchanged row classification.

## Prerequisites

- Registered projects have a Jarvis-owned worktree home discoverable from project configuration.
