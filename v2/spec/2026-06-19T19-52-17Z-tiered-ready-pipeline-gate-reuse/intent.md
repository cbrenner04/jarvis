---
name: tiered-ready-pipeline-gate-reuse
---
# Tiered ready pipeline with gate reuse

**Scope.** `scripts/ready.ts`, harness completion/review gates, `runReadyAndCommit` seam.

## Problem

`bun run ready` always runs install → check:fix → typecheck → test → check. Happy path runs it twice (completion + review final) with duplicate test suites. `bun install --frozen-lockfile` runs even when lockfile and `node_modules` are unchanged.

## Desired behavior

Ready splits into **fast** (`typecheck` + `test`) and **full** (`install` when digest changed → `check:fix` → `typecheck` → `test` → `check`). Harness calls fast tier on recorded-green reuse paths; full tier at completion transition and once before `gh pr ready`. Review final gate reuses recorded green when HEAD and clean tree match completion gate. `runReadyAndCommit` stays the seam; tiers wire through it.

## Decisions

- Two named tiers (`fast`, `full`), not ad-hoc step skipping per caller. Rules out each gate inventing its own partial ready script.
- Install skip keyed on lockfile + `node_modules` digest unchanged. Rules out always running `bun install --frozen-lockfile`.
- Review final gate reuses completion recorded-green only when HEAD and porcelain match. Rules out skipping full ready on dirty or new commits.
- `runReadyAndCommit` remains the harness entry point. Rules out bypassing the existing commit-on-green contract.

## Acceptance signals

- Tests prove fast tier runs only typecheck + test; full tier runs the complete pipeline.
- Tests prove install is skipped when digest unchanged and runs when lockfile changes.
- Tests prove review final gate skips duplicate full ready when HEAD + tree match completion gate.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: tier semantics, when each gate uses fast vs full, recorded-green reuse.
- `v2/docs/v1-behaviors.md`: tiered ready and review gate reuse behavior.

## Out of scope

- Shrink-phase test skipping (shrink intent; consumes fast tier when landed).
- Auto-tick on completion.
- Changing what `check:fix` or `check` cover.

## Prerequisites
