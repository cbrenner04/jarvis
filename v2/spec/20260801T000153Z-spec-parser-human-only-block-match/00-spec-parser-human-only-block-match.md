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
- Join the assembled block as the first-line checklist body plus each continuation line body,
  separated by `\n` (no extra separators) — matches repo wrapped-bullet shape (6-space-indented
  continuations).
- `AcceptanceCriterion.text` remains the first checklist line body; assembled block is used only for
  `humanOnly` — rules out exposing assembled text on the type or changing shrink `afterByText` keys.
- After trimming trailing whitespace and a single trailing period on the assembled block, classify
  `humanOnly` when any marker vocabulary string appears as a case-insensitive contiguous substring of
  that text — rules out trailing `.endsWith` anchoring; marker strings are exactly `(Manual)`,
  `visual inspection only`, and `no automated guard` (unchanged vocabulary).
- Replace `does not match markers mid-text` with negatives that stay automated under contiguous
  substring matching: prose that uses marker-adjacent words but does not contain an exact marker
  phrase (e.g. `manually`, split `visual`/`inspection`, `automated guard` without leading `no`) —
  rules out keeping cases that contradict the new contract.
- Marker vocabulary unchanged — rules out widening accepted markers.
- Guard-inversion evidence is `Mutation checkpoint:` comments on the pinning regression naming source
  mutations on `isHumanOnlyCriterion` and block assembly — rules out production `invert*ForTest`
  hooks.
- Out of scope (owned by sibling intents that list this work as a prerequisite): human-only prose in
  `v1/docs/spec-guidance.md`, `DEFAULT_WRITE_STEP_RULES`, and end-to-end `contract_miss` /
  `already_complete` stranding proof — rules out duplicate doc/workflow work and treating parser unit
  coverage as end-to-end stranding proof.

## Tasks

- In `parseAcceptanceCriteria`, collect continuation lines after each checklist item until the next
  `- [ ]` / `- [x]` line or `##` heading; newline-join first-line body plus continuation bodies for
  `humanOnly` classification; keep `text` as the first-line body only.
- Change `isHumanOnlyCriterion` to case-insensitive contiguous substring search for each marker on
  the supplied text (preserve trailing-whitespace and single trailing-period trim before search).
- Add regression `classifies human-only markers anywhere in the criterion bullet block` in
  `spec-parser.test.ts`: leading and trailing `(Manual)` on one line; continuation-line `(Manual)` on
  a 6-space-indented wrapped bullet (newline-joined block); unmarked negative;
  `Mutation checkpoint:` comments naming both guard mutations.
- Replace `does not match markers mid-text` with negatives that lack an exact marker substring under
  the contiguous-match rule; refresh `isHumanOnlyCriterion` doc-comment.
- Update human-only classification prose in `v2/docs/v1-behaviors.md` (full block + contiguous
  substring match).
- Run `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `spec-parser.test.ts` — `classifies human-only markers anywhere in the criterion bullet block`
      fails pre-fix and passes after the change: leading and trailing `(Manual)` classify
      `humanOnly: true`; a wrapped bullet with `(Manual)` on a 6-space continuation line
      (newline-joined first line plus continuation) classifies `humanOnly: true`; an unmarked criterion
      stays `humanOnly: false`; `AcceptanceCriterion.text` stays the first checklist line body in all
      cases; `Mutation checkpoint:` comments name reverting contiguous substring match to trailing
      `.endsWith` and reverting block assembly to first-line-only.
- [ ] `spec-parser.test.ts` — replacement negatives for retired `does not match markers mid-text`
      stay `humanOnly: false` under contiguous substring matching (marker-adjacent prose without an
      exact marker phrase).
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`
      pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — human-only classification reads the full bullet block (newline-joined
  first line plus continuations) and matches marker vocabulary via case-insensitive contiguous
  substring, not trailing-anchored and not first-line-only.
