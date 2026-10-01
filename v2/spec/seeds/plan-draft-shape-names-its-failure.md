---
name: plan-draft-shape-names-its-failure
---

# Plan draft shape failures name their cause and accept a single nested spec dir

## Problem

`validatePlanDraftShapeAtRoot` and `resolvePlanDraftStagingRoot` (`v2/src/execution/write.ts`) return the same bare `plan.draft.shape` for four distinct failures (missing dir, no `index.md`, no `NN-*.md`, nested-root candidates ≠ 1). Nested-root discovery accepts only `…/spec/<name>/`, so a drafter that writes `<stage>/<timestamp>-<name>/{index.md,00-*.md}` fails. `isEligibleDraftContractReprompt` (`v2/src/execution/write-loop.ts`) excludes `plan.draft.shape`, so the agent is never told, and `pipeline recover` repeats the same opaque reason.

## Evidence

- 2026-10-01: pipeline 62810cc3 lane `ready-gate-attributable-repair-scope` plan settled `contract_miss`/`plan.draft.shape` with a complete tree at `<stage>/20261001T010529Z-ready-gate-attributable-repair-scope/`; `pipeline recover` failed identically; a subagent had to read `write.ts` to find the cause; flattening by hand then `recover` landed it.

## Decisions

- Each shape failure carries a distinct reason suffix (`plan.draft.shape:missing-dir`, `:no-index`, `:no-subspecs`, `:nested-roots=<n>`); `run list`/`wait` and pipeline `failureDetail` show it.
- Nested-root discovery also accepts exactly one immediate child directory of the stage root containing `index.md`, flattened like the `spec/<name>/` layout.
- Shape failures other than `:missing-dir` become eligible for the one in-loop draft reprompt, naming the expected layout (stage root holds `index.md`, `NN-*.md`, `intent.md`).

## Acceptance criteria

- [ ] `write.test.ts` (or the co-located test of the shape resolver): each of the four failure shapes yields its distinct reason; fails against the bare `plan.draft.shape`.
- [ ] Same file: a stage with one immediate child dir holding `index.md` and `00-*.md` resolves and flattens; fails pre-fix.
- [ ] `write-loop.test.ts`: a plan draft `:no-subspecs` miss emits `draft_contract_reprompt`; fails against the current exclusion.

## Documentation updates

- `v2/docs/operator-runbook.md` — plan-draft `contract_miss` paragraph names the shape suffixes and the hand fix (flatten, then `pipeline recover`).
- `v2/docs/write-behavior.md` — accepted staging layouts.
