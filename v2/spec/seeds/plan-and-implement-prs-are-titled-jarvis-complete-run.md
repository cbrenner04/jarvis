# Only intent PRs get a title; every plan and implement PR is `jarvis: complete run`

The PR-title fix landed on **one** of the three publication paths. `intent` names its PRs;
`plan` and `implement` do not, so both publish as the literal fallback string.

## Problem

Observed 2026-07-14. Of the PRs this session:

- Intent PRs (#1518–#1528): titled `intent: <seed-name>`. Correct.
- **Plan PRs (#1529–#1538) and implement PRs (#1539–#1546): all titled `jarvis: complete run`.**

`main`'s history is now a wall of `jarvis: complete run (#NNNN)`, because the squash-merge takes
the PR title. The commit log no longer says what any change did — the operator has to open each
PR to find out.

Mechanism, exactly:

- `v2/src/execution/completion-publisher.ts:234` —
  `return typeof subject === "string" && subject.trim() ? subject.trim() : "jarvis: complete run";`
- `creationTitle` is set in exactly one place: `v2/src/execution/intent-workflow-steps.ts:287`
  (`creationTitle: \`intent: ${name}\``).
- The plan and implement step builders pass nothing, so the fallback fires every time.

## Decisions

- **Every publication path names its PR.** `plan` → the spec/ready-intent name; `implement` → the
  spec name. Rules out a per-path opt-in where forgetting to pass `creationTitle` silently yields
  a generic title.
- **The generic fallback is a defect, not a default.** A publication with no resolvable title
  should be a named failure or derive one from the branch — not ship a string that describes
  nothing. (The branch name alone already carries the spec name.)
- Fix the shared seam, not the three call sites, if the runner can derive the title from the step
  it is publishing for.

## Prerequisites

- None.

## Out of scope

- PRs publishing as **draft** — same seed family (`v2-workflow-pr-stays-draft-and-untitled`), but
  a separate mechanism (`gh pr ready` after the gate). That seed's "untitled" half is what this
  supersedes; the "draft" half stands.

## Documentation updates

- `v2/docs/write-behavior.md` — the publication contract: what titles a PR.
