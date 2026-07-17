# Shrink pass authors the implement PR narrative

## Problem

With subspec 00, `refreshPrBody` accepts an authored narrative but no v2 caller supplies
one. Wire the producer: the post-completion shrink pass authors a review-altitude narrative,
and the publication path threads it into `refreshPrBody` so the implement PR body carries it
in the marker block. No new publication-time agent call — reuse the shrink invocation that
already runs.

## Decisions

- Narrative is authored inside the existing shrink pass (`runShrinkAfterImplementComplete`); publication adds no new agent invocation. Rules out a separate publication-time narrative agent call.
- Narrative is review-altitude — what changed, why, how to verify — not a restatement of the `Spec:` header. The shrink prompt (`prompts/patch/shrink.md`) gains this instruction.
- Threading path: captured narrative flows through the completion publication call into subspec 00's `refreshPrBody` `narrative` input (alongside the existing `bodySummary`/`specTemplate` args).
- Only implement-run publication supplies the narrative; plan/intent publication passes none (their `bodySummary`/template paths are unchanged).
- On re-publish, subspec 00's preserve precedence keeps the existing marker block, so a re-authored narrative does not clobber human edits.
- Deferred to first consumer: the shrink→harness capture seam (agent writes the narrative to a harness-designated, non-committed file the runner reads post-shrink, vs. sentinel-delimited extraction from the shrink invocation output) — pin to whichever the write loop already exposes without committing a narrative file into the branch diff or adding an agent call. Absent narrative capture leaves the marker block unemitted (00's no-narrative path), never fails publication.

## Task checklist

- Add the review-altitude narrative instruction + capture contract to `prompts/patch/shrink.md`.
- Capture the shrink-authored narrative in the runner and thread it to the implement publication call.
- Pass the narrative into `refreshPrBody` via the completion publisher.
- Add integration coverage in `workflow-runner.test.ts` (and/or `completion-publisher.test.ts`).

## Acceptance criteria

- [ ] An integration test drives an implement workflow through shrink to publication with stubbed `gh`/publisher seams and asserts the written PR body carries the shrink-authored narrative inside `NARRATIVE_START_MARKER`/`NARRATIVE_END_MARKER`, distinct from the `Spec:` header; it fails against the pre-fix code (which writes no marker block).
- [ ] A failed or empty narrative capture leaves publication succeeding with no marker block (does not abort the run).
- [ ] Plan and intent publication paths still write no narrative marker block (unchanged), verified by an existing or added assertion.

## Documentation updates

- `v2/docs/workflow-runner.md` — document that the shrink pass authors the PR narrative and where it is threaded into publication.
- `v2/docs/operator-runbook.md` § Gate trust / publication — note the implement PR body now carries an authored narrative in the marker block.
- `v2/docs/v1-behaviors.md` — record the changed v2 implement publication behavior (PR body now carries an agent-authored narrative).
