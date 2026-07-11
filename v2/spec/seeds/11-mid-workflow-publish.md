# Mid-workflow publish after plan draft

**Blocked:** resolve scratch-doc open question #2 (plan publish cadence) before
`jarvis1 plan` this seed. Do not run until decision is pinned below.

## Problem

v1 opens a draft PR after `plan: draft` commit, before review. v2 write loop
publishes only on step `complete`. Plan workflows need commit + draft PR between
draft and review steps when `git: true`.

## Scope (pending decision)

Implement **one** of:

- **A.** Per-step `publishOnComplete` on write steps — plan draft step publishes
  before review step runs in the same daemon run.
- **B.** Document split operator path: `plan` then `plan-review-*` as two workflow
  launches (no mid-run publish) — if chosen, cancel or shrink this seed.

Spec must record chosen option in `## Decisions` before implementation.

## Decisions

- TBD — operator picks A or B and edits this seed before intent.

## Prerequisites

- `plan` draft workflow merged (seed 04).
- At least one plan review preset merged (seed 07 or 08).

## Out of scope

- Intent workflow publish changes.
- Implement publish (already on write completion).

## Reference

- `.scratch/v2-operator-workflows.md` — Mid-workflow git/PR, open question #2

## Documentation updates

- Operator doc — plan PR cadence matches chosen decision
