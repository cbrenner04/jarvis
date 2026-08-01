---
name: intent-landing-contract-rejects-wrapped-bullets
---

# The intent landing contract reads bullets line-by-line and rejects wrapped ones

## Problem

Intent landing refuses a staged intent whose `## Prerequisites` bullet wraps across lines:

```text
intent: <file>.md must list prerequisites as one bullet per line; rerun to retry pre-publication
```

The bullet is valid Markdown — a continuation line is the same list item — but the contract
checks raw lines, so an indented continuation reads as a second, malformed bullet.

Twice on 2026-08-01, both blocking:

- `intent/cursor-usage-is-parsed-then-discarded` — run `f69656a5` settled `landing_failed` on
  `shared-invocation-computes-list-price-cost.md`.
- `intent/pipeline-approval-releases-the-wrong-branch` — run `edc3e2de` settled `landing_failed`
  the same way.

Both recovered only by hand-unwrapping the staged file and `jarvis run resume`. Agents wrap
prose at the repo's ~110-column house style, so this fires on ordinary output, and `MD013` is
disabled in `.markdownlint-cli2.jsonc` — nothing else in the repo asks bullets to be one line.

This is the same defect class as `human-only-marker-read-from-first-line-only` (shipped #2434):
a line-oriented reader over wrapped Markdown. That fix assembled the full bullet block before
classifying; this contract needs the same treatment.

## Decisions

- The contract assembles each bullet from its full block (the list-marker line plus continuation
  lines until the next bullet or a `##` heading) before validating — rules out asking agents or the
  prompt to avoid wrapping, which does not survive a paraphrase.
- Reuse the block-assembly helper introduced by `spec-parser-human-only-block-match` rather than
  a second private line-walker — rules out two divergent notions of "a bullet" in the codebase.
- A genuinely malformed prerequisites section (a non-bullet paragraph, an empty section) still
  refuses with the existing message — rules out relaxing the contract into accepting anything.
- Out of scope: other landing contracts that may read line-by-line. Check them once this proves
  out.

## Acceptance criteria

- [ ] A staged intent whose `## Prerequisites` contains a bullet wrapped across two lines lands
      successfully; a test fails against the current line-by-line contract.
- [ ] A staged intent whose prerequisites bullet wraps across three or more lines, including one
      wrapping mid-inline-code, also lands.
- [ ] A staged intent whose `## Prerequisites` holds a non-bullet paragraph still refuses with the
      existing `must list prerequisites as one bullet per line` message; a regression covers it.
- [ ] Source-mutating block assembly back to first-line-only turns the wrapped-bullet test RED,
      with a comment checkpoint naming the mutation. Do **not** add a production test flag.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Intent finalization failed with staged files remaining — drop
  the hand-unwrap stopgap once this ships.

## Prerequisites

- The intent landing prerequisites contract and its refusal message
- The bullet-block assembly helper from `spec-parser-human-only-block-match` (`shared/spec-parser.ts`)
