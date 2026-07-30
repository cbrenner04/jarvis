---
name: human-only-marker-read-from-first-line-only
---

# Human-only criterion marker is read from the first line only

## Problem

`spec.criteria-ticked` and `implement.already_complete` classify a criterion as human-only by
matching a marker (e.g. `(Manual)`) in the criterion text, but the match sees only the
criterion's first line. A wrapped multi-line criterion whose marker lands on its last line is
treated as automated, so the agent cannot complete the spec and the run settles
`blocked` / `contract_miss`.

Observed 2026-07-30 on `20260730T071756Z-workflow-collapse-drops-test-flag`: a seven-line
criterion ending `...operator verifies the pinning test turns red under that mutation. (Manual)`
blocked two consecutive implement dispatches with `failedContractId: spec.criteria-ticked`,
three of four criteria ticked. Unblocked only by an operator spec edit moving the marker to the
first line (#2321). Markdown line-wrapping is normal in this repo's specs, so marker placement
is invisible to the author.

## Decisions

- Human-only detection reads the criterion's full bullet block — first line plus every
  continuation line up to the next `- [ ]` / `- [x]` or section heading — rules out first-line-only
  matching and rules out asking authors to keep markers on line one.
- The same block-aware text is used by both consumers (`spec.criteria-ticked` completion contract
  and `implement.already_complete` preflight) — rules out fixing one path and leaving the other
  disagreeing about the same criterion.
- Marker vocabulary is unchanged — rules out widening the accepted markers as part of this fix.

## Acceptance criteria

- [ ] A criterion whose `(Manual)` marker appears on a continuation line is classified human-only
      by the same helper that classifies a first-line marker; a pre-fix-failing regression covers
      both placements and a criterion with no marker.
- [ ] `implement.already_complete` preflight and the `spec.criteria-ticked` completion contract
      both consume that helper: a spec whose only unchecked criterion is a wrapped human-only one
      exits `implement.already_complete`, and an implement run over the same spec completes
      instead of settling `contract_miss`.
- [ ] Inverting the continuation-line inclusion turns both regressions RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — human-only markers are matched across a criterion's whole bullet
  block, not its first line.
