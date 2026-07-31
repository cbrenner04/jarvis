---
name: spec-parser-human-only-block-match
---

# Human-only markers match anywhere in a criterion's full bullet block

## Problem

`parseAcceptanceCriteria` and `isHumanOnlyCriterion` (`shared/spec-parser.ts`) classify human-only
criteria from the checklist line body only and require markers at the text tail. Wrapped bullets
whose marker sits on a continuation line, and bullets that lead with `(Manual)`, are treated as
automated — every consumer of `parseSpec` inherits the miss.

## Decisions

- Assemble each acceptance criterion from its full bullet block (first `- [ ]` / `- [x]` line plus
  continuation lines until the next checklist item or `##` heading) before `humanOnly`
  classification — rules out first-line-only matching.
- Recognize `(Manual)`, `visual inspection only`, and `no automated guard` anywhere in that
  assembled text (case-insensitive, whole-phrase) — rules out trailing `.endsWith` anchoring.
- Marker vocabulary unchanged — rules out widening accepted markers.
- Guard inversion mutates `isHumanOnlyCriterion` source; pinning test comment names the mutation —
  rules out production `invert*ForTest` hooks.

## Acceptance criteria

- [ ] A criterion whose `(Manual)` marker appears on a continuation line is classified human-only
      by the same helper as a first-line marker; a pre-fix-failing regression covers both
      placements and a criterion with no marker.
- [ ] A criterion whose `(Manual)` marker leads the bullet (`- [ ] (Manual) …`) is classified
      human-only; a regression covers leading, trailing, and continuation-line placement plus a
      criterion with no marker, and fails against pre-fix trailing-anchored code.
- [ ] Source-mutating the position-independent match back to a trailing anchor turns the leading-
      marker regression RED, with a comment checkpoint naming the mutation. Do **not** add a
      production test flag.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`
      pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — human-only classification reads the full bullet block and matches
  markers at any position, not trailing-anchored and not first-line-only.

## Prerequisites
