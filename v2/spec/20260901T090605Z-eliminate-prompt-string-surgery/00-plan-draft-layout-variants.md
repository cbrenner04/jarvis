# Plan-draft layout variants

`buildPlanDraftPrompt` rewrites assembled `plan.prompt.draft` output with `.replace` / `.replaceAll` for flat external staging and nested `targetDir` layouts; prose edits silently disable those transforms.

## Decisions

- Declare reserved `flat-layout` and `nested-target-dir` variant entries on `prompts/plan/draft.md` and resolve them through `renderArtifactTemplate`; rules out retaining post-render `.replace` in `shared/prompts/plan-draft.ts`.
- Add required `TARGET_DIR:string!` to `plan.prompt.draft` placeholders and reference `<TARGET_DIR>/<NAME>/` in template prose instead of hard-coded `spec/<NAME>/`; caller supplies `TARGET_DIR: opts.targetDir ?? "spec"` — rules out static variant replacements that embed runtime `targetDir` literals (deferred in `prompt-template-variants`).
- `flat-layout` variant applies `[{ "anchor": "- **Only write files under spec/<NAME>/.**", "replacement": "- **Only write files in the working directory.** Do not create spec/ subdirectories or other parent paths." }, { "anchor": "spec/<NAME>/intent.md", "replacement": "intent.md", "replaceAll": true }]` — rules out inferring flat substitutions from `plan-draft.ts`.
- `nested-target-dir` variant applies `[{ "anchor": "spec/<NAME>/", "replacement": "<TARGET_DIR>/<NAME>/", "replaceAll": true }]` only; flat-layout variant owns write-boundary and `intent.md` path anchors — rules out one variant carrying both flat-boundary and nested-prefix substitutions.
- Select `flat-layout` when `opts.flatSpecLayout` is true, `nested-target-dir` when `opts.targetDir !== "spec"`, otherwise omit `options.variant` — rules out implicit default variant selection.
- Runtime suffix assembly (`## File output`, `## Step completion`, harness diagnostics) stays appended after `renderArtifactTemplate` — rules out baking staging paths into the registry artifact.

## Tasks

- Add `TARGET_DIR` and `variants` frontmatter to `prompts/plan/draft.md`; bump `revision`.
- Route `buildPlanDraftPrompt` through `renderArtifactTemplate` on the assembled step body; drop pre-render `.replace` calls.
- Extend `shared/prompts/plan-draft.test.ts` with flat-layout and nested-`targetDir` regression tests that fail against the pre-fix `.replace` path.

## Acceptance criteria

- [ ] `shared/prompts/plan-draft.test.ts` — flat-layout and nested `targetDir` layout tests fail against pre-fix `.replace` surgery in `plan-draft.ts` and pass after template-variant migration.
- [ ] `v1/test/modes/plan/spec-dir.test.ts` stays green.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` stays green.

## Documentation updates

- None. Behavior-preserving refactor; `v2/docs/prompts.md` already documents reserved variant ids.
