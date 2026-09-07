---
name: cleanup-reclaims-and-publishes-terminal-artifacts
---

# Cleanup publishes staged terminal archives without dirtying the operator checkout

## Prerequisites

- Cleanup stages completed specs for archival only after terminal worktree eligibility succeeds.

## Module-boundary surface

- Cleanup artifact publication: isolated archive moves and rollback in `v2/src/commands/cleanup-artifacts.ts`.

## Problem

Cleanup leaves archive moves uncommitted on the primary checkout and does not recover when publication fails.

## Behavior

- Cleanup publishes a staged archive move from an isolated cleanup-owned worktree and branch, leaving the primary checkout unchanged and clean.
- A local publication failure restores the source and archive paths and names the failed step.
- The operator pushes the successful cleanup branch and opens its one archive PR after local publication. (Manual)

## Decision ledger

- Commit archive moves from an isolated cleanup-owned branch and worktree; rules out committing on or leaving moves in the primary checkout.
- Roll archive moves back after a commit, push, or PR failure; rules out an uncommitted `D` plus `??` archive pair.
- Treat push and PR creation as human verification because the implementation worktree has no network or GitHub access.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `archive publication leaves the primary checkout clean` proves a successful staged move is committed on an isolated cleanup branch with no primary-checkout diff; it fails against the pre-fix uncommitted rename.
- [ ] `v2/src/commands/cleanup.test.ts` test `archive publication failure restores the source tree` proves a failed local publication step leaves no archive move or primary-checkout dirt and emits a named failure; it fails against the pre-fix silent dirty state.
- [ ] The committed cleanup branch is pushed and proposed as one archive PR. (Manual)
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — isolated archive publication, rollback, and manual push/PR handoff.
- `v2/docs/v1-behaviors.md` — record v2 archive-publication behavior and v1 divergence.

## Primary implementation surface

v2/src/commands/cleanup-artifacts.ts
