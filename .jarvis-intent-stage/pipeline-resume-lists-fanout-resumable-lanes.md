---
name: pipeline-resume-lists-fanout-resumable-lanes
---

# Pipeline resume lists resumable fan-out lanes when branch key is omitted

## Problem

Fan-out is the norm after intent split, but `jarvis pipeline resume <pipeline-id>` without a branch key either derives awaiting-approval continuation or refuses opaquely — operators detour through `pipeline list --json` to discover which `branch-key` to pass for a failed plan lane.

## Decision ledger

- `pipeline resume <pipeline-id>` with no branch key on a fan-out pipeline lists resumable branch keys instead of only refusing; rules out a `pipeline list --json` detour to find a slug.
- Listing is discoverability only — it does not resume multiple lanes in one call; rules out implicit multi-lane dispatch.
- Deferred to first consumer: exact stdout layout and sort order for listed branch keys — pin when the CLI formatter needs it.

## Acceptance criteria

- [ ] `pipeline.test.ts` drives `pipeline resume <pipeline-id>` with no branch key on a fan-out pipeline that has at least one resumable failed plan lane and asserts stdout or stderr lists those branch keys instead of an opaque refusal; fails against the pre-fix behavior that omits branch keys.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline resume: omitting `branch-key` on a fan-out pipeline lists resumable lanes.

## Primary implementation surface

v2/src/commands/pipeline.ts

## Prerequisites

- Failed plan-lane resume dispatches without manual edits when staged `intent.md` carries only the reserved `Artifact contract check failed:` harness blocker.
- Failed plan-lane resume dispatches without a manual commit when the worktree holds only harness draft dirt.
- Failed plan-lane resume refuses when staged `intent.md` carries an operator-authored `## Blocker`, naming the resolved absolute path of the staged file.
- Failed plan-lane resume reports retired-and-rematerialized versus reused worktree disposition on success.
