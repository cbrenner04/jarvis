---
name: no-commit-intent-path-after-draft
---

## Raw seed

<details>
<summary>Raw seed</summary>

<<<RAW_SEED_BEGIN>>>
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

<<<RAW_SEED_END>>>

</details>

## Intent

# No-commit intent path is printed after drafting

## Prerequisites

- Work applies to v1 plan mode no-commit output.
- Existing committed plan behavior should remain unchanged.

## Problem

In `commit: false` plan runs, Jarvis writes the external `intent.md` after the intent has a final name. If a later refine, draft, or review phase fails before the normal completion handoff, the operator may not see where that useful artifact landed.

## Desired behavior

- Print the absolute external `intent.md` path immediately after a `commit: false` intent is named and written.
- Print that path before any later refine, draft, or review phase can fail.
- Keep successful no-commit completion output centered on the existing external `index.md` run handoff.
- Leave committed fresh-run handoff output unchanged.

## Decisions

- Do not wait for `index.md` generation before surfacing the external `intent.md` path.
- Do not replace the final no-commit `jarvis1 run <index.md>` handoff with an intent-only message.
- Do not change no-commit artifact layout or completion semantics.

## Acceptance signals

- Regression coverage proves a no-commit run prints the external `intent.md` path after intent drafting and before a simulated later phase failure.
- Regression coverage proves a successful no-commit run prints both the early external `intent.md` path and the existing `jarvis1 run <index.md>` handoff.
- Regression coverage proves committed fresh-run handoff output is unchanged.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` to say no-commit runs print the external `intent.md` path after naming succeeds.
- Update `v2/docs/v1-behaviors.md` for the changed v1 plan-mode output.

## Out of scope

- Changing no-commit spec storage layout.
- Adding a PR or git handoff for `commit: false`.
- Changing completion semantics for generated `index.md`.

## Refinement

- Emit the early external `intent.md` path on stdout; rule out stderr-only milestone logging because the existing no-commit handoff is stdout.
