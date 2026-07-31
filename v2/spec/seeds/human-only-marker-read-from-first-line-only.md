---
name: human-only-marker-read-from-first-line-only
---

# Human-only criterion marker is missed by position and by wrapping

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

**Second, larger failure mode (2026-07-31): the marker is trailing-anchored, and plan agents
write it leading.** `isHumanOnlyCriterion` (`shared/spec-parser.ts:300`) lowercases the text and
calls `.endsWith(marker)`, so `(Manual)` only counts at the **end** of the criterion. Every plan
drafted this session put it at the front — `- [ ] (Manual) Inverting the …` — and every one of
those was therefore classified automated. It settled the CLI hook-removal implement at
`contract_miss` with the criterion the agent could not possibly satisfy (#2392, hand-finished),
and the daemon plan emitted four more leading-marker bullets. Nothing in the injected write-step
rules or `spec-guidance` states the anchor, so the author cannot know.

The two modes share one cause: marker recognition depends on a position the spec author is never
told about.

## Decisions

- Human-only detection reads the criterion's full bullet block — first line plus every
  continuation line up to the next `- [ ]` / `- [x]` or section heading — rules out first-line-only
  matching and rules out asking authors to keep markers on line one.
- The same block-aware text is used by both consumers (`spec.criteria-ticked` completion contract
  and `implement.already_complete` preflight) — rules out fixing one path and leaving the other
  disagreeing about the same criterion.
- A marker is recognized **anywhere** in the criterion's bullet block — leading, trailing, or on a
  continuation line — rules out the current trailing anchor, which no author-facing document states.
- The plan and implement write-step rules state where a human-only marker may appear and name the
  accepted markers, so drafts stop depending on undocumented placement — rules out fixing the
  parser while leaving the prompt silent. A rendered-prompt test pins that text.
- Marker vocabulary is unchanged — rules out widening the accepted markers as part of this fix.

## Acceptance criteria

- [ ] A criterion whose `(Manual)` marker appears on a continuation line is classified human-only
      by the same helper that classifies a first-line marker; a pre-fix-failing regression covers
      both placements and a criterion with no marker.
- [ ] `implement.already_complete` preflight and the `spec.criteria-ticked` completion contract
      both consume that helper: a spec whose only unchecked criterion is a wrapped human-only one
      exits `implement.already_complete`, and an implement run over the same spec completes
      instead of settling `contract_miss`.
- [ ] A criterion whose `(Manual)` marker **leads** the bullet (`- [ ] (Manual) …`) is classified
      human-only; a regression covers leading, trailing, and continuation-line placement plus a
      criterion with no marker, and fails against the pre-fix trailing-anchored code.
- [ ] The plan and implement write-step rules name the accepted human-only markers and state that
      placement within the criterion is free; a rendered-prompt test pins that text.
- [ ] Source-mutating the position-independent match back to a trailing anchor turns the leading-
      marker regression RED, with a comment checkpoint naming the mutation. Do **not** add a
      production test flag.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — human-only markers are matched anywhere in a criterion's whole
  bullet block: any position on any line, not trailing-anchored and not first-line-only.
- `v1/docs/spec-guidance.md` — state the accepted markers and that placement is free.
