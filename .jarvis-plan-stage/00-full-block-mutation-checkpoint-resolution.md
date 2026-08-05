# Full-block mutation-checkpoint resolution and directive linking

## Problem

`verifyMutationCheckpoints` selects mutation-checkpoint criteria from each acceptance-criterion
bullet block (first checklist line plus continuation lines) but resolves pinning tests and links
directives from `criterion.text` (first line only). Wrapped pinning-test backticks or enclosing-test
names on continuation lines resolve to `undefined` → `unresolved_pinning_test`, or fail to link →
`hollow`, blocking completion despite valid pins.

## Decisions

- Resolution and linking pass `criterionBlocks[index] ?? criterion.text` to `resolveLinkedDirectives` (and any sibling call site that passes `criterion.text` for resolution/linking) — rules out keeping first-line-only resolution while selection already uses the full block.
- Carry block index through the post-filter loop (iterate with index, or map `{ criterion, block }` at filter time) so `criterionBlocks[index]` aligns with each selected criterion.
- No change to `pinningTestReferenceFromCriterion` / `linkDirectivesToCriterion` — rules out duplicating block assembly inside those helpers.
- Out of scope: enclosing-test naming guidance (`mutation-checkpoint-criterion-must-name-enclosing-test`) — this seed makes wrapped names resolvable; that seed requires naming at all.

## Tasks

1. In `verifyMutationCheckpoints`, map selected criteria to `{ criterion, block }` at filter time
   (`block = criterionBlocks[index] ?? criterion.text`).
2. Pass `block` into `resolveLinkedDirectives` (and any sibling resolution/linking call site still
   on `criterion.text`).
3. Add regressions in `mutation-checkpoint-verifier.test.ts`: wrapped pinning-test backtick on a
   continuation line reaches `caught`; wrapped enclosing-test name on a continuation line links
   (not `hollow`); guard-inversion pin with single-line criterion and `@mutate` reverting full-block
   resolution.
4. Update `v2/docs/operator-runbook.md` § Gate trust, `v1/docs/spec-guidance.md` §
   Mutation-checkpoint criteria, and `v2/docs/v1-behaviors.md`.
5. Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `wrapped pinning-test reference on continuation line resolves and catches` proves a ticked mutation-checkpoint criterion whose pinning-test backtick sits on a 6-space continuation line (newline-joined wrapped bullet) resolves to that test file and its linked directive is applied (reaches `caught`), not `unresolved_pinning_test`; it fails against first-line-only resolution.
- [ ] `mutation-checkpoint-verifier.test.ts` — `wrapped enclosing-test name on continuation line links directive` proves a wrapped criterion whose enclosing-test name is on a continuation line links its directive (not `hollow`); it fails against first-line-only linking.
- [ ] `mutation-checkpoint-verifier.test.ts` stays green.
- [ ] `mutation-checkpoint-verifier.test.ts` — `wrapped pinning-test reference on continuation line resolves and catches`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` reverting the `resolveLinkedDirectives` argument from full-block text back to `criterion.text`; reverting full-block resolution turns the named pin red. Author the criterion single-line — `` `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `wrapped pinning-test reference on continuation line resolves and catches`; `` on line 1 — so it resolves under the current, unfixed verifier; name the enclosing test verbatim.
- [ ] `v2/docs/operator-runbook.md` § Gate trust states pinning-test resolution and directive linking read the full acceptance-criterion bullet block (aligned with selection); wrapped pinning-test references and enclosing-test names on continuation lines resolve.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria states wrapping the pinning-test reference onto a continuation line is safe.
- [ ] `v2/docs/v1-behaviors.md` states mutation-checkpoint resolution/linking uses the full bullet block, not `criterion.text` first line only.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — pinning-test resolution and directive linking read the full acceptance-criterion bullet block (aligned with selection); wrapped pinning-test references and enclosing-test names on continuation lines resolve.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — wrapping the pinning-test reference onto a continuation line is safe.
- `v2/docs/v1-behaviors.md` — mutation-checkpoint resolution/linking uses the full bullet block, not `criterion.text` first line only.
