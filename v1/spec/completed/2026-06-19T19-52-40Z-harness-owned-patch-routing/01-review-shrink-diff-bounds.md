# Review and shrink diff bounds

## Problem

`buildReviewPrompt` inlines the full unified branch diff via `getBranchDiff`.
Large implementation branches blow review prompt size. Shrink must keep full
unified diff only for allowlisted implementation files, not the whole branch.

## Decisions

- Introduce `getBranchDiffSummary(cwd, baseBranch)` shared helper: merge-base via
  `git merge-base <baseBranch> HEAD` (same semantics as `getBranchDiff` /
  `getRunScopedDiff`); then `git diff --stat <mergeBase> HEAD` and
  `git diff --name-only <mergeBase> HEAD`; emit repo-relative paths sorted
  lexicographically, one per line, after the stat block under a `Changed paths:`
  heading; on failure return a parenthesized error string like today's diff
  helpers. Rules out divergent merge-base logic across call sites.
- Patch review prompts inject branch diff **summary** into existing
  `BRANCH_DIFF` placeholder; placeholder name unchanged, content is summary not
  unified diff. Update `prompts/patch/review-*.md` section headings/prose that
  say "unified diff" to describe branch change summary. Rules out stat injected
  under a heading still labeled unified diff.
- Shrink keeps full unified diff in `RUN_SCOPED_DIFF` for allowlisted paths
  only; never inject full branch diff. Rules out regressing shrink to
  whole-branch unified diff.
- Shrink may add the same branch summary block for orientation; summary is
  additive, not a replacement for allowlisted full diff. Rules out dropping
  allowlisted full diff in favor of summary-only shrink context.
- Bump affected review step prompt revisions and any shrink step revision when
  placeholder names or section headings change. Rules out silent template drift
  without revision provenance.
- Patch review rendered fixtures do not exist today; create them under
  `v1/test/fixtures/prompts/rendered/` when review step revisions bump (not
  merely regenerate). Rules out assuming pre-existing patch review snapshot files.
- Review prompts keep the completed spec tree (`SPEC_TREE`) unchanged. Rules
  out spec-tree slimming in this subspec.

## Tasks

- Add `getBranchDiffSummary`; replace `getBranchDiff` usage in
  `buildReviewPrompt` with summary output.
- Update `prompts/patch/review-*.md` summary headings/prose per decisions;
  bump review step revisions.
- Confirm `buildShrinkPrompt` uses allowlisted full diff only; add branch
  summary section to shrink template only if the helper is wired there.
- Add tests in `v1/test/modes/patch/review.test.ts` proving review prompts
  contain stat + changed paths, lack `^diff --git` / `^@@` hunk markers outside
  allowed blocks, and would fail if full unified branch diff is reintroduced.
- Add/extend `v1/test/modes/patch/shrink.test.ts` proving shrink prompts never
  include full branch unified diff outside the allowlisted `RUN_SCOPED_DIFF`
  block.
- Create patch review rendered fixtures when review step revisions bump.
- Update `v1/docs/run-loop.md` `## Review phase` and `### Post-completion
  shrink`; replace stale review/shrink bullets in `v2/docs/v1-behaviors.md`.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [x] `buildReviewPrompt` for adversary, advocate, and adjudicator roles
      includes branch diff stat and changed-path listing in `BRANCH_DIFF`; it
      does not include full unified diff hunks (`diff --git` / `@@` markers) for
      the whole branch.
- [x] Review prompt tests assert presence of stat/path summary and absence of
      unified-diff hunk markers outside allowed blocks so reintroducing
      `getBranchDiff` output on the review path fails.
- [x] `buildShrinkPrompt` includes full unified diff only for allowlisted paths
      in `RUN_SCOPED_DIFF`; it does not include full unified diff for the whole
      branch.
- [x] Shrink prompt tests fail if full branch unified diff appears outside the
      allowlisted diff block.
- [x] Review templates label the `BRANCH_DIFF` section as branch change summary,
      not unified diff.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md` (`## Review phase`, `### Post-completion shrink` only;
  `00` owns `## Iteration` / `## Iteration banner`): capped review diff context
  (stat + paths) and shrink allowlisted full diff contract.
- `v2/docs/v1-behaviors.md`: replace stale patch review and shrink bullets
  (do not only append). Cite `v1/src/modes/patch/prompt.ts`,
  `prompts/patch/review-*.md`, `prompts/patch/shrink.md`.

## Out of scope

- Implementation prompt routing (`00-implementation-prompt-routing.md`).
- Plan mode review prompts.
- Spec-tree slimming in review/shrink.
- Diff size limits inside allowlisted shrink files.
