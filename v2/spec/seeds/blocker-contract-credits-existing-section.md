---
name: blocker-contract-credits-existing-section
---

# The blocker contract credits a `## Blocker` already present at settle time, not only one appended this invocation

## Problem

A run whose spec carries a complete, agent-authored `## Blocker` still settles `missing_blocker`, because the contract credits only a `## Blocker` written **during the settling invocation** (before/after content diff, per `write-behavior.md`). A section appended in an earlier iteration of the same run — checkpointed by the per-iteration committer — does not count. The reprompt then puts the agent in an unwinnable position: the only way to satisfy the contract is to append a *second* `## Blocker` duplicating the existing one.

## Evidence (2026-08-28, #3029)

Pipeline `af881ac0` on `cbrenner04/chess-mvp-yolo`, run `fb52cb87`, lane `board-display-settings`: iterations 1–3 committed progress and a full `## Blocker` landed in the subspec. Iteration 4 emitted `blocked`; the before/after diff for that invocation showed no newly-appended `## Blocker` (it already existed) → `blocker_reprompt` (seq 11) → still no *new* section → `missing_blocker` (seq 14), `invocation_failure`, run paused; stage `failureDetail.reason: "missing_blocker"`. A well-behaved blocked outcome (spec blocker present, final token `blocked`) was mislabeled a protocol violation.

## Decisions

- A `blocked` outcome is satisfied when a non-empty `## Blocker` section is present in the spec tree at settle time, regardless of whether this specific invocation authored it. Rules out crediting only a within-invocation append.
- The within-invocation before/after append remains sufficient (unchanged); the existing-section check is an additional accepting path. Rules out weakening detection for the fresh-append case.
- A `blocked` token with no `## Blocker` anywhere in the spec still reprompts, then settles `missing_blocker` as today. Rules out accepting a bare `blocked` with no blocker text.

## Acceptance criteria

- [ ] A write-loop/blocker-contract test proves a `blocked` outcome with a pre-existing non-empty `## Blocker` (authored an earlier iteration, unchanged this invocation) settles the documented `blocked` terminal, not `missing_blocker`; it fails against the append-only check.
- [ ] A test proves a fresh within-invocation `## Blocker` append still settles `blocked` (no regression).
- [ ] A test proves a `blocked` token with no `## Blocker` present still reprompts then settles `missing_blocker`.
- [ ] `bun run typecheck` and the touched-surface test scripts pass.

## Documentation updates

- `v2/docs/` write-behavior/blocker contract doc (and `v1/docs/` equivalent if shared) — a `## Blocker` present at settle time satisfies the contract, not only one appended during the settling invocation.
