---
name: plan-accepts-and-validates-base-flag
---

# `plan` accepts `--base <ref>` and validates it before daemon contact

`jarvis run workflow plan` gains a `--base <ref>` flag with the same resolution and validation semantics `implement --base` already uses. Omitted, plan resolves the repository base exactly as today (the default branch), so existing dispatches are unchanged.

An explicit `--base` that does not resolve to a tree-ish in the local project clone is rejected before any daemon contact: the command exits non-zero naming the ref, and creates no run row, worktree, or read-context checkout. External `--base` resolves against local refs only — the operator must have fetched the base branch locally; plan never treats it as a remote ref or reaches the network. This is the CLI admission seam only: parsing, usage/help surface, local-ref validation, and threading the resolved base into the plan workflow input. The downstream effect of the base on what the agent reads is owned by later surfaces.

## Prerequisites

## Documentation updates

- `v2/docs/write-behavior.md` — CLI surface: the new `plan --base` flag.
- `v2/docs/operator-runbook.md` — § Workflow presets: `plan --base` accepts a base ref (external requires the base fetched locally).
