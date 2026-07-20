---
name: an-intent-run-publishes-at-most-one-pr-per-split
---

# An intent run publishes at most one PR per split

## Problem

A single `jarvis run workflow intent` invocation opened two PRs for the same split (#1689 and
# 1692), both adding the identical ready-intent file. The first landed and its `intent/<slug>` branch
was deleted on merge; a second publication then fired, re-created the just-deleted branch, and
re-published the same file as a duplicate PR that had to be closed by hand. The foreground CLI
returned `completed` once, then a second publication fired later against the same branch name.

Duplicate PRs cost triage time, break the run→PR mapping (two PRs, one run), and would double-add the
same file if not caught.

## Decisions

- A workflow run publishes at most one PR per output branch for one logical split — a second publication cannot fire after the first has landed.
- Publication is idempotent against an already-merged/-deleted branch: a branch deleted because its PR merged is not re-created and re-opened.
- A legitimate re-publish (e.g. retry after a failed push) targets the same open PR, not a second one.

## Notes

Trigger unproven — the second publish may be a shrink/re-publish tail firing after merge, or a
retried publication re-keyed on a stale branch. Capture is the deliverable; root-cause during
implementation. Sibling of the silent-publication class (publication ran zero times, reported
success) — opposite symptom, same seam: publication's relationship to run lifecycle.

## Prerequisites
