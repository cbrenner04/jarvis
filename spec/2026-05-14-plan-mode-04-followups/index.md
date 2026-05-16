# Plan mode — follow-ups from PR #30 review

repo: git@github.com:cbrenner04/jarvis.git

This spec collects the **deferred** items from the moderator review of
[PR #30](https://github.com/cbrenner04/jarvis/pull/30) (which implemented
`spec/2026-05-14-plan-mode-draft-and-review/`). The "must-fix" items from that review
were addressed inside PR #30 itself; everything captured here is either a
secondary refinement, a hardening pass, or a question that is better
answered by a separate, focused spec.

The scope here is intentionally narrow: each subspec should be land-able on
its own without depending on any of the others, and none of them change the
externally-observable contract of `jarvis plan` for the non-interactive
cases that PR #30 made useful.

## Origin

These items came from the PR #30 review thread. They are listed by review
comment number for traceability; the comment numbers themselves carry no
meaning beyond "this is which note this addresses."

## What this spec does *not* do

- **No new phases.** Interview, resume, and handoff stay in their own
  pre-existing specs (`spec/2026-05-14-plan-mode-interview/`,
  `spec/2026-05-14-plan-mode-resume-and-handoff/`).
- **No agent-prompt rewrites beyond the targeted clarifications below.**
- **No changes to commit shape, PR header, attribution, or worktree
  layout** beyond the targeted hardening below.

## Subspecs

- [x] [01 — Prompt and template hardening](./01-prompt-and-template-hardening.md)
- [x] [02 — Spec-file write boundary enforcement](./02-spec-file-write-boundary.md)
- [x] [03 — Review-loop ergonomics and resumability](./03-review-loop-ergonomics.md)
- [ ] [04 — PR body and attribution polish](./04-pr-body-and-attribution-polish.md)
- [ ] [05 — Test-suite and tooling cleanups](./05-tests-and-tooling.md)

## Conventions

- Run this spec with `jarvis run spec/2026-05-15-plan-mode-followups/index.md` once
  it is merged to `main`.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop.

## Non-goals

- Anything covered by `spec/2026-05-14-plan-mode-interview/`,
  `spec/2026-05-14-plan-mode-resume-and-handoff/`, or
  `spec/2026-05-14-pr-body-updates-and-attribution/`.
- Rewriting plan-mode tests from scratch — only targeted additions and
  small refactors are in scope here.
