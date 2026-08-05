---
name: mutation-verifier-resolves-from-full-bullet-block
---

# Mutation-checkpoint resolution reads only the criterion's first line, so wrapped refs go hollow

`verifyMutationCheckpoints` **selects** a criterion from the full bullet block but
**resolves** its pinning test and links its directive from `criterion.text` — the
**first line only**. So a mutation-checkpoint criterion whose pinning-test backtick (or
enclosing test name) wraps onto a continuation line resolves to `undefined` →
`unresolved_pinning_test` (a hard-blocking `unparseable`), or fails to link its directive
→ `hollow`. The tick then hard-fails the `spec.criteria-ticked` contract, blocking
completion, even though the pin is real and correct.

This is the single biggest source of implement blocks this session: it blocked the
`criteria-based-subspec-routing` bundle-2 branch (~35 min + hand-fix), and forces every
mutation-checkpoint criterion to be authored as one long line (contra normal spec
wrapping). It is inconsistent with human-only detection, which already reads the full
bullet block.

## Root cause

In `verifyMutationCheckpoints` (`v2/src/execution/mutation-checkpoint-verifier.ts`):

- Selection (line ~438) uses `const markerSource = criterionBlocks[index] ?? criterion.text`
  — the **full block** (`acceptanceCriterionBlocks`), so `Mutation checkpoint:` /
  `@mutate` markers on continuation lines are seen.
- Resolution (line ~456) passes `criterion.text` — the **first line only** — to
  `resolveLinkedDirectives`, which calls `pinningTestReferenceFromCriterion(criterion.text)`
  and `linkDirectivesToCriterion(criterion.text, …)`. A wrapped pinning-test backtick or
  enclosing-test name on line 2+ is invisible.

`parseAcceptanceCriteria` (`shared/spec-parser.ts`) stores only the first line as
`criterion.text` by design; the block-aware text is `criterionBlocks[index]`.

## Decisions

- Resolution and linking use the **full bullet block** (`criterionBlocks[index] ??
  criterion.text`), the same source selection already uses — so a wrapped pinning-test
  reference and enclosing-test name resolve and link exactly as an unwrapped one. One-line
  change at the `resolveLinkedDirectives` call site (and any sibling call passing
  `criterion.text` for resolution/linking).
- No change to `pinningTestReferenceFromCriterion` / `linkDirectivesToCriterion`
  themselves — they already scan whatever text they are given.
- Out of scope: the separate "criterion must name the enclosing test" authoring guidance
  ([[mutation-checkpoint-criterion-must-name-enclosing-test]]) — this seed makes a wrapped
  name resolvable; that seed is about naming it at all.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — a ticked mutation-checkpoint criterion whose
      pinning-test backtick is on a **continuation line** (wrapped bullet) resolves to that
      test file and its linked directive is applied (reaches `caught`), not
      `unresolved_pinning_test`; a regression fails against first-line-only resolution.
- [ ] `mutation-checkpoint-verifier.test.ts` — a wrapped criterion whose enclosing-test
      **name** is on a continuation line links its directive (not `hollow`); fails against
      first-line-only linking.
- [ ] `mutation-checkpoint-verifier.test.ts` — an unwrapped (single-line) mutation-checkpoint
      criterion keeps resolving and linking exactly as today (no regression).
- [ ] Mutation checkpoint: a `// @mutate` directive reverting resolution back to
      `criterion.text` (first-line-only) turns its pinning test RED; author the criterion
      single-line (pinning-test file + enclosing test name on line 1) so it resolves under
      the current, unfixed verifier, and name the enclosing test verbatim.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — mutation-checkpoint resolution now reads the
  full bullet block, so a wrapped pinning-test reference no longer blocks; remove any
  "author on one line" workaround note.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — wrapping the pinning-test
  reference onto a continuation line is safe.

## Prerequisites

- `verifyMutationCheckpoints`, `resolveLinkedDirectives`, `acceptanceCriterionBlocks`
  (`v2/src/execution/mutation-checkpoint-verifier.ts`)
- `parseAcceptanceCriteria` first-line `text` vs block text (`shared/spec-parser.ts`)
