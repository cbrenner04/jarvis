# 02 - Spec runs summarize spec H1 and subspec checklist

A plan/write (spec-authoring) PR body says `Spec: <dir>` only. Supply a summary: the spec H1 plus the index's subspec checklist lines, mirroring the v1 header in `v1/src/modes/plan/pr.ts` (`parseIndex` / `buildPlanPrHeader`).

## Decisions

- Parsing and rendering happen at the runner's spec-authoring publish call site; the publisher receives a finished string (per `00`, it interprets nothing).
- Trigger is the spec-authoring (plan/write) publish site itself, not a path-shape test — rules out a "directory contains `index.md` and isn't an intent run" predicate, which an implementer can read backwards onto implement/patch runs whose body `00` forbids changing.
- Summary is built at publish time by parsing `<publication spec path>/index.md` (H1 + checklist lines), not from step metadata — the index only exists after the write step runs.
- Checklist lines are emitted verbatim from `index.md` (link text + target preserved) — rules out re-rendering them, which would drift from the index.
- The checklist is emitted in full: no truncation, no top-N cap (v1's header doesn't cap). "Terse" means no generated prose, not a length limit.
- Missing or H1-less `index.md` ⇒ no summary (body falls back to today's shape) rather than a failed publish; the PR body is not a gate.
- H1 with zero checklist items ⇒ H1 line only, no empty list.

## Acceptance criteria

- [x] A plan/spec run's PR body contains the spec H1 and its subspec checklist above the narrative markers and footer.
- [x] The `Spec:` pointer and attribution footer are still present and unchanged in shape.
- [x] Republishing the same spec run leaves the body identical (regenerated, not appended); a later refresh after the index changes reflects the new checklist.
- [x] Every checklist item in the index appears in the body — none dropped or truncated.
- [x] An index with an H1 and no checklist items yields an H1-only summary.
- [x] A publication spec path with no readable `index.md` publishes successfully with the pre-existing body shape.
- [x] Implement/patch runs' PR bodies are unchanged (no summary rendered).

## Documentation updates

- `v2/docs/write-behavior.md` — record the spec-run body shape.
