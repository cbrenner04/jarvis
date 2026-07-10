---
name: finalize-pr-attribution-and-ready
---

# Finalize PR attribution and mark a completed run ready

## Problem

The v2 runner can open a draft PR, but reviewers cannot see which agents wrote
its commits and successful completion does not advance the PR to ready.

## Direction

Render the PR attribution footer from `Jarvis-Agent` trailers on qualifying
`baseRef..HEAD` commits, using the established v1 commit selection and
first-seen label deduplication semantics. Refresh the draft PR body with that
footer while preserving any supported narrative-marker content.

For a completed run, execute the runner's ready gate while the PR remains
draft. Only after the gate succeeds, call `gh pr ready <branch>`. A gate failure
leaves the PR draft and fails finalization. Apply bounded transient retry to the
ready call; treat `already ready` and `not a draft` responses as success to
cover a lost acknowledgement.

## Decisions

- Attribution is derived from branch commit trailers — rules out binding the footer to the final agent, current process, or SQLite attempt rows.
- The ready gate precedes `gh pr ready` — rules out exposing an unverified PR as ready.
- Failed verification leaves the PR draft — rules out flipping first and attempting rollback.
- Ready retry accepts `already ready` and `not a draft` — rules out failing after GitHub applied the transition but its acknowledgement was lost.
- Narrative preservation is limited to stable markers — rules out promising that arbitrary edits to generated header or footer survive refresh.

## Documentation updates

- Complete the durable v2 PR lifecycle doc with attribution rendering, body refresh, ready-gate ordering, and failure semantics.
- Mark the ported attribution and draft-to-ready behaviors in `v2/docs/v1-behaviors.md`.

## Prerequisites

- Completed v2 runs create commits carrying `Jarvis-Agent` trailers and a qualifying `Spec:` body line
- Completed v2 run branches are pushed and have an idempotently managed open draft PR
