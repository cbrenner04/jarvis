---
name: retire-v2-nomenclature
---

# Retire the `v2` nomenclature

> **Confirm scope with the owner before dispatch.** Repo-wide rename; high churn.

## Problem

`v1` is frozen and there will never be a `v3`; `jarvis` is the only engine. The `v2` label survives as a directory (`v2/src`, `v2/spec`, `v2/docs`), in script names (`test:v2`, `test:integration:v2`), CI scope rules, doc prose ("v2 harness", "v2 operator runbook"), `v1-behaviors.md` tags (`[v2 additive]`), and config (`plan.targetDir: v2/spec`). It is now a planning-era label baked into paths and names, which CLAUDE.md forbids for code identifiers.

## Decisions (proposed)

- Drop the version from prose and names where it only means "the current engine".
- Directory move (`v2/` → top-level or `engine/`), script renames, and CI scope updates are one decision; decide whether to do it or keep the directory and rename only prose/scripts.
- `v1/` and `v1-behaviors.md` keep their names (they describe a real frozen generation).

## Acceptance criteria

- [ ] To be written once scope is confirmed.

## Documentation updates

- `CLAUDE.md`, `v2/docs/**`, runbook, brief, ledger.
