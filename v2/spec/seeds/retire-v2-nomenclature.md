---
name: retire-v2-nomenclature
---

# Retire the `v2` nomenclature

## Problem

`v1` is frozen and there will never be a `v3`; `jarvis` is the only engine. The `v2` label survives as a directory (`v2/src`, `v2/spec`, `v2/docs`), in script names (`test:v2`, `test:integration:v2`), CI scope rules, doc prose ("v2 harness", "v2 operator runbook"), `v1-behaviors.md` tags (`[v2 additive]`), and config (`plan.targetDir: v2/spec`). It is now a planning-era label baked into paths and names, which CLAUDE.md forbids for code identifiers.

## Prerequisites

- [[fold-shared-into-v2]] lands first; there is then one runtime tree to move.

## Decisions

- Drop the version from prose and names where it only means "the current engine".
- Move `v2/` to the repository top level (`v2/src` → `src`, `v2/spec` → `spec`, `v2/docs` → `docs`), renaming scripts (`test:v2` → `test`-slice names), CI scope rules, and `plan.targetDir` in the same change.
- `v1/` and `v1-behaviors.md` keep their names (they describe a real frozen generation).

## Acceptance criteria

- [ ] No tracked path under `v2/` remains; imports, scripts, CI scope, and `plan.targetDir` resolve at the new top-level paths.
- [ ] No doc prose, script name, or `v1-behaviors.md` tag uses `v2` to mean the current engine (`v1` references stay).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `CLAUDE.md`, `v2/docs/**`, runbook, brief, ledger.
