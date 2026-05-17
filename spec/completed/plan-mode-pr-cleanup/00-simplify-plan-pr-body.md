# Simplify plan-mode PR body

## Problem

`buildPlanPrHeader` in `src/modes/plan/pr.ts` produces a PR body with two
problems:

1. A `## Progress: <checked>/<total>` heading followed by a verbatim mirror of
   the index checklist. The checkboxes never get checked during plan mode
   (subspec completion is a patch-mode concern), so the section is always
   `0/N` and adds noise.
2. Prose written to the human reader ("This PR was authored by `jarvis
   plan`...", "Plan mode never marks this PR ready for review. Once you have
   reviewed (and edited) the spec, mark it ready and merge to `main`...").
   The PR body is GitHub UI chrome, not a message to the reviewer.

The PR body should be short and useful: identify the spec, link to the files
that matter, and stop there.

## Scope

- Rewrite `buildPlanPrHeader` in `src/modes/plan/pr.ts` so its output is the
  H1 title (from `index.md` or fallback `Plan: <name>`) followed by a short
  bullet list of the intent and index file paths. Drop the `## Progress`
  section and the checklist mirror entirely. Drop the multi-line prose
  paragraph about reviewing/merging.
- Update or replace the existing tests for `buildPlanPrHeader` to assert the
  new shape: title present, no `## Progress`, no checklist lines, no
  reviewer-directed prose, intent/index paths still present.
- Leave the attribution footer (`renderPlanAttribution`) unchanged — it is a
  separate concern and `[[01-mark-plan-pr-ready]]` does not touch it.

## Out of scope

- Changing when the PR is created or marked ready (see
  `[[01-mark-plan-pr-ready]]`).
- Changing the patch-mode PR body (`src/modes/patch/pr.ts`).
- Removing the narrative-section markers from `src/pr.ts`.

## Acceptance criteria

- [x] `buildPlanPrHeader` no longer emits a `## Progress: x/y` line.
- [x] `buildPlanPrHeader` no longer emits the verbatim index checklist
      inside the PR body.
- [x] `buildPlanPrHeader` no longer emits the "This PR was authored by
      `jarvis plan`..." paragraph or the "Plan mode never marks this PR
      ready for review..." paragraph.
- [x] The output still contains the H1 title (from `index.md` when present,
      else `# Plan: <name>`) and still references `spec/<name>/intent.md`
      and `spec/<name>/index.md` so reviewers can navigate to the files.
- [x] Tests covering `buildPlanPrHeader` are updated to match the new shape
      and pass.

## Documentation

- If `AGENTS.md` or any doc under `docs/` describes the plan-mode PR body
  shape (e.g. the "PR attribution" section referenced from
  `src/modes/plan/pr.ts`), update it to match the new shape. If no such
  description exists, no doc change is needed.
