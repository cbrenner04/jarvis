# Spec must be committed before run

`jarvis run` currently does not care whether the spec file is committed to
the project's base branch. If the spec is untracked (or has uncommitted
modifications) in the main checkout when `jarvis run` is invoked, the
worktree resolution still works — the harness copies the active spec into
the worktree on first iteration — but the spec then lands inside the
implementation PR via `git add -A` instead of existing on `main` as a
reviewable artifact ahead of the work.

The right shape for normal use is the opposite: author and commit the spec
to the base branch first, then run jarvis against the now-tracked path. This
keeps implementation PR diffs focused on code and lets the spec be
reviewed/sanity-checked separately, before any agent iterations are spent.

This spec makes that workflow explicit in docs and adds a soft prompt at
`jarvis run` start so it's hard to forget without being impossible to
override.

## Subspecs

- [ ] [00 — Document workflow B](./00-document-workflow-b.md)
- [ ] [01 — Run-start spec tracking check](./01-run-start-tracking-check.md)
- [ ] [02 — Documentation updates](./02-documentation-updates.md)

## Conventions

- Run this spec with `jarvis run spec/spec-must-be-committed/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If the subspec is blocked, append a `## Blocker` section to that file and
  stop.
