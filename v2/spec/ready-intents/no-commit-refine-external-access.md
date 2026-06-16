---
name: no-commit-refine-external-access
---

# No-commit refine can edit external intent

## Prerequisites

## Problem

For `commit: false`, intent draft writes `intent.md` under `~/.jarvis/specs/...`, but refine runs from the target repository cwd. Agents with workspace write boundaries can fail to read or append to the external artifact.

## Desired behavior

- For `commit: false`, intent refinement runs with read/write access to the external spec artifact.
- Refine can append `## Refinement`, `## Refine skip`, or `## Blocker` to external `intent.md`.
- Committed plan behavior is unchanged.

## Decisions

- Run no-commit refine against the external spec artifact contract; rule out target-repo-only cwd as the writable boundary.
- Preserve external spec storage for no-commit specs; rule out silent fallback to in-repo specs.
- Fix the agent cwd/access contract; rule out shell-copying intent content through the target repository.

## Acceptance signals

- A regression test covers `commit: false` refine success against an external spec path.
- The test proves the external `intent.md` contains the refine outcome after the phase.
- Existing `commit: true` refine tests still pass.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` to state no-commit refine edits the external `intent.md`.
- Update `v2/docs/v1-behaviors.md` for the changed v1 plan-mode behavior.

## Out of scope

- Changing default `modes.plan.commit`.
- Reworking v2 `jarvis intent` or ready-intent flow.
- Broad sandbox policy changes outside plan refinement.
