# An intent run publishes two PRs for one split

## Problem

A single `jarvis run workflow intent --seed <seed>` invocation opened **two** PRs for the same
split: #1689 and #1692, both adding the identical ready-intent
`completion-commit-subject-describes-the-change.md`. #1689 was merged; #1692 re-created the
just-deleted `intent/<slug>` branch and re-published the same file, so it had to be closed by hand.

Observed 2026-07-17. The foreground CLI call returned `completed` once (the run I merged from), then
a second publication fired later under the same branch name — after that branch had been deleted on
merge — producing a duplicate PR against `main` for work already landed.

Duplicate PRs cost operator triage time and, if not caught, would double-add the same file (merge
conflict or redundant history). It also confuses the run/PR mapping: two PRs, one run.

## Decisions

- A workflow run publishes at most one PR per output branch for one logical split; rules out a second
  publication firing after the first has landed.
- Publication is idempotent against an already-merged/-deleted branch: if the intended branch was
  deleted because its PR merged, the run does not re-create it and re-open a PR; rules out
  resurrecting a consumed branch.
- If a legitimate re-publish is needed (e.g. retry after a failed push), it targets the *same* open
  PR rather than opening a second; rules out duplicate-PR fan-out on retry.

## Notes

Related to the silent-publication class ([[a-swallowed-gh-auth-precheck-aborts-publication-and-still-reports-completed]])
— both are publication-path reliability bugs — but the opposite symptom: there, publication ran zero
times and reported success; here it ran twice. The publication step's relationship to run lifecycle
(which run id owns publication, when it may re-fire) is the common thread.

Exact trigger unproven: the second publish may be the shrink/re-publish tail firing after merge, or a
retried publication re-keyed on a stale branch. Capture is the deliverable; root-cause during
implementation.
