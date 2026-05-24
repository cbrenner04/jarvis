# 01 - Make patch PR bodies terse

Patch-mode PR bodies currently restate the index: title, progress count, full
subspec checklist, and then attribution. For completed multi-subspec work this
creates long PR bodies that repeat information already visible in the diff and
spec files. PR #131 made the failure obvious.

Make patch PR bodies concise by default. The PR should say what changed and keep
machine-maintained metadata compact; it should not dump the full spec routing
table or repeated per-commit noise into the body.

## Task checklist

- Change patch PR body rendering to remove the progress section and linked
  subspec checklist from the default body.
- Preserve any human narrative section already present in a PR body.
- Make attribution terse: keep the final "Written by ..." summary, but do not
  list every subspec commit by default.
- Keep plan-mode PR attribution behavior out of scope unless shared helpers must
  change.
- Update tests that currently assert verbose patch PR body output.

## Acceptance criteria

- [ ] A generated patch-mode implementation PR body contains the spec title and
      preserved narrative, but no `## Progress` section and no verbatim linked
      subspec checklist.
- [ ] Patch-mode attribution renders a compact summary line without a
      per-subspec commit bullet list in the default PR body.
- [ ] Duplicate implementation attempts for the same subspec cannot create
      duplicated visible attribution lines in the PR body.
- [ ] Existing narrative marker preservation still works when `updatePrBody`
      rewrites a body.
- [ ] Tests cover the terse body shape, narrative preservation, empty-footer
      behavior, and the compact attribution footer.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

Update `AGENTS.md`, `v1/docs/worktrees-and-commits.md`, or the narrower PR
lifecycle documentation that currently promises the verbose per-commit
attribution list. The docs should state the new default: terse PR header,
optional preserved narrative, compact attribution summary.

