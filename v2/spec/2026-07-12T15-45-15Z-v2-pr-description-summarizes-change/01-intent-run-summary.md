# 01 - Intent runs summarize seed subject and authored intents

An intent PR body says `Spec: <dir>` only. Supply a summary: the seed subject plus one line per authored intent file.

## Decisions

- The summary is re-derived at every publish from the landed durable spec dir (the intent files jarvis owns there), not handed over from a same-invocation landing call — landing is idempotent and reports the owned files for an already-landed invocation, so retries and resumes rebuild the same block.
- Both intent branches feed the same derivation: the plain-intent branch (lands before publish) and the review-last branch (`landIntentWorkflowOutput` near `workflow-runner.ts:1379`, whose result is currently discarded and leaves the publication spec path unset). The review-last branch must set the publication spec path so the durable dir is derivable — rules out an AC with no mechanism behind it.
- Subject comes from the workflow-supplied creation title (the same metadata that titles the PR) — rules out re-parsing the seed.
- Intent-run detection reuses the existing `completionStep.intentOutput !== undefined` signal at that site — rules out adding a new step field for workflow kind.
- Body block is a subject line + a bullet per intent file. No generated prose.
- Landed-files list is empty ⇒ subject line only, no empty bullet list.
- Creation title is the generic fallback (`jarvis: complete run`) ⇒ suppress the subject line rather than render the fallback as a subject.

## Acceptance criteria

- [ ] An intent run's PR body contains the seed subject and one line per authored intent file, above the narrative markers and footer.
- [ ] The `Spec:` pointer and attribution footer are still present and unchanged in shape.
- [ ] Republishing the same intent run (retry/resume) leaves the body identical — the summary is re-derived from the landed dir, not appended.
- [ ] Reviewed-intent workflows (review step last) publish the same summary — the review-last landing sets the publication spec path the derivation reads.
- [ ] A generic-fallback creation title publishes bullets with no subject line.

## Documentation updates

- `v2/docs/write-behavior.md` — record the intent-run body shape.
