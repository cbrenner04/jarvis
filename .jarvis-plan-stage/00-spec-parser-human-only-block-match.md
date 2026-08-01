# Spec parser human-only block match

## Problem

`parseAcceptanceCriteria` and `isHumanOnlyCriterion` (`shared/spec-parser.ts`) classify human-only
criteria from the first checklist line body only and require markers at the text tail. Wrapped bullets
whose marker sits on a continuation line, and bullets that lead with `(Manual)`, are treated as
automated — every `parseSpec` consumer inherits the miss.

## Decisions

- Assemble each acceptance criterion from its full bullet block (first `- [ ]` / `- [x]` line plus
  continuation lines until the next checklist item or `##` heading) before `humanOnly`
  classification — rules out first-line-only matching.
- `AcceptanceCriterion.text` remains the first checklist line body; assembled block is used only for
  `humanOnly` — rules out exposing assembled text on the type or changing shrink `afterByText` keys.
- Recognize `(Manual)`, `visual inspection only`, and `no automated guard` anywhere in assembled text
  (case-insensitive, whole-phrase) — rules out trailing `.endsWith` anchoring.
- Marker vocabulary unchanged — rules out widening accepted markers.
- Replace `does not match markers mid-text` trailing-anchor negatives with assertions aligned to
  position-independent matching within the assembled block — rules out keeping cases that contradict
  the new contract.
- Guard-inversion evidence is comment checkpoints on the pinning regression naming source mutations
  on `isHumanOnlyCriterion` and block assembly — rules out production `invert*ForTest` hooks.

## Tasks

- In `parseAcceptanceCriteria`, collect continuation lines after each checklist item until the next
  `- [ ]` / `- [x]` line or `##` heading; join for `humanOnly` classification; keep `text` as the
  first-line body only.
- Change `isHumanOnlyCriterion` to whole-phrase match anywhere in the supplied text (preserve
  trailing-whitespace and single trailing-period trim before search).
- Add regression `classifies human-only markers anywhere in the criterion bullet block` in
  `spec-parser.test.ts` covering leading, trailing, and continuation-line `(Manual)` placement plus
  an unmarked negative; add `Mutation checkpoint:` comments naming both guard mutations.
- Update or replace `does not match markers mid-text` and refresh `isHumanOnlyCriterion` doc-comment.
- Update human-only classification prose in `v2/docs/v1-behaviors.md`.
- Run `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `spec-parser.test.ts` — `classifies human-only markers anywhere in the criterion bullet block`
      fails pre-fix and passes after the change: leading, trailing, and continuation-line `(Manual)`
      placements classify `humanOnly: true`; an unmarked criterion stays `humanOnly: false`;
      `AcceptanceCriterion.text` stays the first checklist line body in all cases.
- [ ] `spec-parser.test.ts` — `Mutation checkpoint:` on the pinning regression names reverting
      position-independent match to trailing `.endsWith` (RED on leading and trailing placements)
      and reverting block assembly to first-line-only (RED on continuation-line placement); operator
      verifies each source mutation turns the regression RED. (Manual)
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`
      pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — human-only classification reads the full bullet block and matches
  markers at any position, not trailing-anchored and not first-line-only.
