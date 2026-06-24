---
name: auto-ready-pr-on-review-failure
---

# Auto-ready the PR on a gate-green tree even when the review phase fails

## Problem

When the completion gate is green but the post-completion review phase fails, the PR is left in
draft because auto-ready only runs after review succeeds. Review is a quality pass, not a merge
gate, so a gate-green-but-review-failed run leaves the operator blocked on a manual `gh pr ready`.

## Direction

On a criteria-complete, gate-green tree, auto-ready the PR even when the review phase could not
complete, so the operator is not blocked on a draft. The PR is readied on the strength of the
green completion gate; the review failure is still reported as a partial outcome.

## Out of scope

- Changing what the review phase runs or its quota resilience.
- The exit-code / `exitReason` reporting of the review-only failure.

## Prerequisites

- The run distinguishes a review-only failure (criteria-complete + gate-green, review phase failed) from an implementation failure.
