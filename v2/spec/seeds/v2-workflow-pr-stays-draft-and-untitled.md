# A completed v2 workflow leaves its PR draft and titled "jarvis: complete run"

A v2 workflow run that completes successfully publishes a PR that is (a) still a **draft**
and (b) titled **`jarvis: complete run`**. The operator must hand-run `gh pr ready` and
retitle before it can merge.

## Problem

Observed 2026-07-13 on the `plan` preset (run `93d8c854`, PR #1482):

- The run reached `completed` and published its PR.
- `gh pr merge 1482 --admin --squash` → `GraphQL: Pull Request is still a draft`. The
  operator must `gh pr ready 1482` by hand first.
- The PR title was `jarvis: complete run` — the workflow name, the spec name, and the
  ready-intent name are all absent. Every v2 workflow PR gets this same title, so a list of
  open PRs is unreadable.

**`v2-pr-title-from-workflow` is in `v2/spec/completed/` (2026-07-12T14-12-31Z) and the bug
still reproduces.** This is the third instance of the archive-is-not-proof pattern the
runbook already warns about; the fix landed somewhere the `plan` preset's publication path
does not reach.

Two hand steps on every single v2 PR is the largest recurring manual cost in a v2 session —
the north star is a shrinking count of manual interventions, and this one scales with
throughput.

## Decisions

- **A run that completes flips its PR ready.** A draft PR is the correct state for an
  *in-flight* run, not a completed one. Rules out leaving the flip to the operator or to
  `triage`.
- **The PR title names the work**, derived from the spec/ready-intent the workflow ran —
  not the workflow's internal completion event. Rules out any title that is identical across
  unrelated runs.
- **Re-verify `v2-pr-title-from-workflow` against the `plan` and `intent` publication paths
  before assuming a shared fix covers them.** The archived spec's fix demonstrably does not.

## Prerequisites

- None.

## Out of scope

- PR body content — that is `v2-pr-description-summarizes-change` (also archived; re-verify
  it on the same paths).

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — completion publishes a ready, named PR.
- `v2/docs/operator-runbook.md` — drop the manual `gh pr ready` + retitle stopgap when this
  ships.
