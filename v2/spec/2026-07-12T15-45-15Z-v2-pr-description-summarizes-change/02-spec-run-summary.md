# 02 - Spec runs summarize spec H1 and subspec checklist

A plan/write (spec-authoring) PR body says `Spec: <dir>` only. Supply a summary: the spec H1 plus the index's subspec checklist lines, mirroring the v1 header in `v1/src/modes/plan/pr.ts` (`parseIndex` / `buildPlanPrHeader`).

## Decisions

- Summary is built at publish time by parsing `<publication spec path>/index.md` (H1 + checklist lines), not from step metadata — the index only exists after the write step runs.
- Applies when the published spec path is a directory containing `index.md` and the run is not an intent run — rules out a new workflow-kind step field.
- Checklist lines are emitted verbatim from `index.md` (link text + target preserved) — rules out re-rendering them, which would drift from the index.
- Missing or H1-less `index.md` ⇒ no summary (body falls back to today's shape) rather than a failed publish; the PR body is not a gate.

## Acceptance criteria

- [ ] A plan/spec run's PR body contains the spec H1 and its subspec checklist above the narrative markers and footer.
- [ ] The `Spec:` pointer and attribution footer are still present and unchanged in shape.
- [ ] Republishing the same spec run leaves the body identical (regenerated, not appended); a later refresh after the index changes reflects the new checklist.
- [ ] A publication spec path with no readable `index.md` publishes successfully with the pre-existing body shape.

## Documentation updates

- `v2/docs/write-behavior.md` — record the spec-run body shape.
