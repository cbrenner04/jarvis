---
name: review-failure-distinct-exit-reason
---

# Post-completion review failure reports as a distinct partial outcome, not a generic error

## Problem

When the spec reaches criteria-complete with a green completion gate but the post-completion
review/auto-ready phase then fails (e.g. every review role exhausts quota), `jarvis1 run`
propagates the review phase's exit code as a generic failure. An operator reading the result
can't tell "code is broken" from "code is fine, review couldn't run" without reading the log.
The implementation commits and draft PR are intact, but the outcome reads as a hard error.

## Direction

Distinguish a review-only failure from an implementation failure in the run's reported outcome:

- Emit a distinct exit code + `exitReason` (e.g. `review-incomplete`) when the tree was
  criteria-complete and gate-green and only the post-completion review/auto-ready phase failed.
- Leave the implementation commits and PR intact; emit a clear operator message naming the
  review failure reason and the recovery path (finalize, or re-run with `--resume-review`).

Determinism/safety of what runs is unchanged; this is reporting a partial outcome only.

## Out of scope

- Making the review phase more quota-resilient.
- Auto-readying the PR on a gate-green tree when review failed.

## Prerequisites
