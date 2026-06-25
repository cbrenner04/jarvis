---
name: run-human-only-criteria-open-pr-not-block
---

# run: human-only acceptance criteria open a reviewable draft PR instead of blocking with no PR

## Problem

A run whose remaining unchecked acceptance criteria are flagged human-only
(`(Manual)`, "visual inspection only", "no automated guard") blocks at exit 7
with no PR. On a CSS/layout spec the agent implemented the fix, committed, passed
the automated gate, then tried to launch a dev server to visually confirm, hit a
sandbox bind error (`listen EPERM … ::1:3000`), and exited `blocked` leaving the
branch at a local `WIP: … (blocked, 4/7 criteria)` commit. The operator's
objective for UX/visual work is a reviewable PR a human then verifies — blocking
suppresses that PR and burns a turn on a dev-server launch the sandbox forbids.

Observed on `groceries-client`, intake issue #536.

## Behavior

- The patch agent treats criteria the spec flags human-only as operator-verified:
  implement, pass the automated gate, leave those criteria unchecked with a
  reviewer-facing note — does not attempt in-sandbox visual verification (no
  dev-server port bind) and does not raise a `## Blocker` for them.
- When a run's only remaining unchecked criteria are human-only, the run completes
  the normal draft-PR path (it is not treated as incomplete or blocked); the
  unchecked human-only criteria surface as a human-verify checklist on the PR.
- Specs whose unmet criteria are *automated* still block as today — only
  spec-flagged human-only criteria are exempt.

## Out of scope

- Inventing new marker syntax beyond what the seed names (`(Manual)`, "visual
  inspection only", "no automated guard").

## References

- Intake issue #536.

## Prerequisites

- Patch-mode completion opens a draft PR after the automated ready gate passes on git:true runs.
- Patch mode injects the patch.rules fragment into the agent prompt.
- The harness detects a `## Blocker` in the active subspec and exits the run with code 7.
