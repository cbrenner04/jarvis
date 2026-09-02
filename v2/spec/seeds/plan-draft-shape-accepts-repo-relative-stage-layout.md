---
name: plan-draft-shape-accepts-repo-relative-stage-layout
---

# Plan drafts staged at `v2/spec/<name>/` are rejected as a shape violation

## Problem

`resolvePlanDraftStagingRoot` (`v2/src/execution/write.ts`) accepts exactly two staged layouts: a flat tree at the staging root, or **one** nested `spec/<name>/` tree, which `listNestedPlanDraftSpecDirs` finds by looking only at `join(stagingDir, "spec")`.

Agents routinely stage the tree at `v2/spec/<name>/` instead — the repo-relative path that `AGENTS.md`, the spec guidance, and every existing spec train them to use ("new specs default to `v2/spec/`"). That path misses the `spec/` probe, `resolvePlanDraftStagingRoot` returns `plan.draft.shape`, and the run settles `blocked` / `contract_miss` with a sound, complete draft sitting on disk.

The prompt tells the agent one path and the validator accepts a different one. This is a shape mismatch, not a draft-quality problem — every observed instance was hand-corrected by moving directories, with the draft content untouched.

## Evidence

- 2026-09-02, pipeline `310ae5fb` lane `notification-incident-candidate-store-queries`: staged a correct two-subspec tree at `.jarvis-plan-stage/v2/spec/20260902T213705Z-…/` (`index.md`, `00-…md`, `01-…md`). Settled `blocked` / `contract_miss` / `plan.draft.shape`. Recovered by hand-moving the tree to `spec/<name>/` and running `pipeline recover`, which then landed it unchanged.
- 2026-08-30: two of the five contract-miss-blocked plans hand-landed in #3165 were the "nested `v2/` stage layout" shape (recorded in `structural-recovery-brief.md`).
- #3212 (`plan-draft-shape-accepts-nested-stage-layout`) closed the `spec/<name>/` case and left this sibling open.

## Decisions

- Accept a staged tree nested under any single repo-relative prefix that ends in the project's spec directory — `v2/spec/<name>/` and `spec/<name>/` both resolve, flattening before normalization exactly as #3212 does today. Rules out enumerating one hardcoded prefix per project layout.
- Resolution stays unambiguous: exactly one candidate spec directory must be discoverable, else `plan.draft.shape` still refuses. Rules out silently picking one of several nested trees.
- Do not fix this by adding a reprompt arm — the draft is already correct, so re-invoking the agent spends a role invocation to reproduce the same bytes. Rules out the `plan-draft-contract-miss-reprompts-before-blocking` approach for this failure.
- Keep the refusal for genuinely shapeless drafts (no `index.md`, zero `NN-*.md` subspecs) unchanged.

## Acceptance criteria

- [ ] A staged draft at `<staging>/v2/spec/<name>/` with `index.md` and at least one `NN-*.md` resolves and flattens to the staging root — pinned by a test that fails against the current `spec/`-only probe.
- [ ] A staged draft at `<staging>/spec/<name>/` still resolves and flattens — pinned by a test (no regression of #3212).
- [ ] Two nested candidate spec directories under different prefixes still refuse with `plan.draft.shape` — pinned by a test.
- [ ] A staged tree with no `index.md` still refuses with `plan.draft.shape` — pinned by a test.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — the accepted plan-draft staging layouts.
