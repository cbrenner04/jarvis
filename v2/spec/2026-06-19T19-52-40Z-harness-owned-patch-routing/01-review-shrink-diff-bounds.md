# Review and shrink diff bounds

## Problem

`buildReviewPrompt` inlines the full unified branch diff via `getBranchDiff`.
Large implementation branches blow review prompt size. Shrink must keep full
unified diff only for allowlisted implementation files, not the whole branch.

## Decisions

- Patch review prompts inject branch diff **summary** only: `git diff --stat`
  plus changed path list (merge-base…HEAD). Rules out full unified branch diff
  in adversary/advocate/adjudicator prompts.
- Shrink keeps full unified diff in `RUN_SCOPED_DIFF` for allowlisted paths
  only; never inject full branch diff. Rules out regressing shrink to whole-branch
  unified diff.
- Shrink may add the same branch summary block for orientation; summary is
  additive, not a replacement for allowlisted full diff. Rules out dropping
  allowlisted full diff in favor of summary-only shrink context.
- Introduce a shared helper for branch diff summary used by review (and shrink
  if summary is added); keep `getRunScopedDiff` for allowlisted full diff.
  Rules out duplicating git invocations divergently across call sites.
- Bump affected review step prompt revisions and any shrink step revision when
  placeholder names or section headings change; regenerate rendered fixtures if
  present. Rules out silent template drift without revision provenance.
- Review prompts keep the completed spec tree (`SPEC_TREE`) unchanged. Rules
  out spec-tree slimming in this subspec.

## Tasks

- Replace `getBranchDiff` usage in `buildReviewPrompt` with summary output; update
  `prompts/patch/review-*.md` placeholders/section labels if needed.
- Confirm `buildShrinkPrompt` uses allowlisted full diff only; add branch
  summary section to shrink template only if the helper is wired there.
- Add tests in `v1/test/modes/patch/review.test.ts` (or adjacent) proving review
  prompts contain stat + changed paths and do not contain full unified diff
  hunks for out-of-scope files.
- Add/extend `v1/test/modes/patch/shrink.test.ts` proving shrink prompts never
  include full branch unified diff outside the allowlisted `RUN_SCOPED_DIFF`
  block.
- Regenerate review rendered fixtures when step revisions bump.
- Update `v1/docs/run-loop.md` review/shrink sections and
  `v2/docs/v1-behaviors.md` review/shrink bullets.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] `buildReviewPrompt` for adversary, advocate, and adjudicator roles
      includes branch diff stat and changed-path listing; it does not include the
      full unified diff for the whole branch.
- [ ] `buildShrinkPrompt` includes full unified diff only for allowlisted paths
      in `RUN_SCOPED_DIFF`; it does not include full unified diff for the whole
      branch.
- [ ] Review prompt tests fail if `getBranchDiff`-style full unified output is
      reintroduced on the review path.
- [ ] Shrink prompt tests fail if full branch unified diff appears outside the
      allowlisted diff block.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: document capped review diff context (stat + paths) and
  shrink allowlisted full diff contract.
- `v2/docs/v1-behaviors.md`: update patch review and shrink bullets to record
  bounded branch diff in review and allowlist-only full diff in shrink. Cite
  `v1/src/modes/patch/prompt.ts`, `prompts/patch/review-*.md`,
  `prompts/patch/shrink.md`.

## Out of scope

- Implementation prompt routing (`00-implementation-prompt-routing.md`).
- Plan mode review prompts.
- Spec-tree slimming in review/shrink.
- Diff size limits inside allowlisted shrink files.
