---
name: no-commit-intent-path-after-draft
---

# No-commit intent path is printed after drafting

## Prerequisites

## Problem

After no-commit intent draft names and writes the external artifact, the operator may not see the `intent.md` path until the full plan pipeline succeeds. A later phase failure can leave the only useful artifact hard to find.

## Desired behavior

- After a `commit: false` intent is named and written, Jarvis prints the absolute external `intent.md` path.
- The path is printed before later refine, draft, or review phases can fail.
- Successful no-commit completion still prints the existing external `index.md` run handoff.
- Committed plan output is unchanged.

## Decisions

- Print `intent.md` immediately after final naming; rule out waiting for `index.md` generation.
- Keep the final success handoff centered on `index.md`; rule out replacing the run command with an intent-only path.

## Acceptance signals

- A regression test covers no-commit output after intent draft and before a simulated later phase failure.
- A regression test covers no-commit success output containing both the early `intent.md` path and the existing `jarvis1 run <index.md>` handoff.
- Committed fresh-run handoff output is unchanged.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` to say no-commit runs print the external `intent.md` path after naming succeeds.
- Update `v2/docs/v1-behaviors.md` for the changed v1 plan-mode output.

## Out of scope

- Changing no-commit spec storage layout.
- Adding a PR or git handoff for `commit: false`.
- Changing completion semantics for generated `index.md`.
