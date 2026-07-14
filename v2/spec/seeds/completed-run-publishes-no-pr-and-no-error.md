# A run reports `completed`, pushes its branch, and publishes no PR — with no error

An implement run committed its work, pushed the branch to `origin`, reported `runStatus:
completed` with **no operator error and no `ready_finalize_failed`** — and created no pull
request. Nothing in `run list`, the run log, or `daemon.log` says a PR was ever attempted.

## Problem

Observed 2026-07-14, spec `20260714T023458Z-quota-detection-matches-typographic-apostrophe`
(runs `d39b7c74` and `39a40920`, same branch):

- Worktree HEAD: `3cbfc2c6 jarvis: complete run` (`Jarvis-Agent: claude`), real diff.
- `git ls-remote origin` → the branch is on the remote at that exact sha.
- `jarvis run list` → two rows, both `completed`, error column `-`.
- `gh pr list` → **no PR for that branch.**

The operator only noticed because the PR count didn't match the run count. Had they trusted
`completed`, finished work would have sat on a remote branch indefinitely with nothing pointing
at it. Two sibling runs in the same batch (#1539, #1540) published PRs normally, so this is not
a config or auth problem — it is nondeterministic.

Textbook instance of the pattern the P0 session named: **a terminal status asserted without the
evidence that would substantiate it.** `completed` on a git-enabled workflow should mean the PR
exists.

## Decisions

- **A workflow run that pushes a branch does not report `completed` until its PR exists.** A
  publication that produces no PR is a run failure with a named error, not a silent success.
  Rules out today's behavior.
- The run's terminal record carries the PR number (or URL) it published, so `completed` is
  falsifiable from `run list` alone without calling `gh`.
- Reproduce first, then fix. `findOrCreatePr` (`v2/src/execution/completion-publisher.ts:194`)
  lists open PRs for the head branch and creates one only when none matches `baseRef` — a stale
  or empty `pr list` result, or a `baseRef` mismatch, silently yields "found it, nothing to do".
  That is a candidate, not the diagnosis.

## Prerequisites

- None.

## Out of scope

- The `run workflow` exit code (`run-workflow-exits-zero-on-failed-run`).
- Draft-vs-ready PR state (`v2-workflow-pr-stays-draft-and-untitled`).

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — what `completed` guarantees about publication.
- `v2/docs/write-behavior.md` — the completion boundary's publication contract.
