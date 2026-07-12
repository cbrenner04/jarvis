# 01 - Intent runs summarize seed subject and authored intents

An intent PR body says `Spec: <dir>` only. Supply a summary: the seed subject plus one line per authored intent file.

## Decisions

- The runner builds the summary at the publish call site in `v2/src/execution/workflow-runner.ts`, reusing `landIntentWorkflowOutput(...).files` (the landed intent filenames) — rules out re-reading the stage dir, which is already consumed by landing.
- Subject comes from the workflow-supplied creation title (the same metadata that titles the PR) — rules out re-parsing the seed.
- Intent-run detection reuses the existing `completionStep.intentOutput !== undefined` signal at that site — rules out adding a new step field for workflow kind.
- Body block is a subject line + a bullet per intent file. No generated prose.
- Landed-files list is empty ⇒ subject line only, no empty bullet list.

## Acceptance criteria

- [ ] An intent run's PR body contains the seed subject and one line per authored intent file, above the narrative markers and footer.
- [ ] The `Spec:` pointer and attribution footer are still present and unchanged in shape.
- [ ] Republishing the same intent run (retry/resume) leaves the body identical — the summary is regenerated, not appended.
- [ ] Reviewed-intent workflows (review step last) produce the same summary once landing happens.

## Documentation updates

- `v2/docs/write-behavior.md` — record the intent-run body shape.
