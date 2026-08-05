---
name: mutation-verifier-resolves-from-full-bullet-block
---

# Mutation-checkpoint resolution reads the full bullet block

The fix touches one module-boundary surface (execution loop), so splitting does not apply.

`verifyMutationCheckpoints` selects mutation-checkpoint criteria from the full bullet block but resolves pinning tests and links directives from `criterion.text` (first line only). Wrapped pinning-test backticks or enclosing-test names on continuation lines resolve to `undefined` → `unresolved_pinning_test`, or fail to link → `hollow`, blocking completion despite valid pins.

## Decisions

- Resolution and linking pass `criterionBlocks[index] ?? criterion.text` to `resolveLinkedDirectives` (and any sibling call site that passes `criterion.text` for resolution/linking) — rules out keeping first-line-only resolution while selection already uses the full block.
- Carry block index through the post-filter loop (iterate with index, or map `{ criterion, block }` at filter time) so `criterionBlocks[index]` aligns with each selected criterion.
- No change to `pinningTestReferenceFromCriterion` / `linkDirectivesToCriterion` — rules out duplicating block assembly inside those helpers.
- Out of scope: enclosing-test naming guidance (`mutation-checkpoint-criterion-must-name-enclosing-test`) — this seed makes wrapped names resolvable; that seed requires naming at all.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — a ticked mutation-checkpoint criterion whose pinning-test backtick is on a continuation line (wrapped bullet) resolves to that test file and its linked directive is applied (reaches `caught`), not `unresolved_pinning_test`; a regression fails against first-line-only resolution.
- [ ] `mutation-checkpoint-verifier.test.ts` — a wrapped criterion whose enclosing-test name is on a continuation line links its directive (not `hollow`); fails against first-line-only linking.
- [ ] `mutation-checkpoint-verifier.test.ts` stays green.
- [ ] Mutation checkpoint: a `// @mutate` directive reverting resolution back to `criterion.text` (first-line-only) turns its pinning test RED; author the criterion single-line (pinning-test file + enclosing test name on line 1) so it resolves under the current, unfixed verifier, and name the enclosing test verbatim.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — pinning-test resolution and directive linking read the full acceptance-criterion bullet block (aligned with selection); wrapped pinning-test references and enclosing-test names on continuation lines resolve.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — wrapping the pinning-test reference onto a continuation line is safe.
- `v2/docs/v1-behaviors.md` — mutation-checkpoint resolution/linking uses the full bullet block, not `criterion.text` first line only.

## Prerequisites

- Mutation-checkpoint criterion selection reads the full acceptance-criterion bullet block (including continuation lines) for marker detection.
- `parseAcceptanceCriteria` stores only the first checklist line as `criterion.text`; block-aware text is available via `acceptanceCriterionBlocks`.
