---
name: cleanup-archive-pr-publication-seams
---

# Completion publisher exposes push and open-or-reuse PR for archive branches

## Problem

`jarvis cleanup` must push `cleanup/archive-*` branches and open a ready archive PR. Push, lease handling, and `gh pr create` / open-PR reuse live inside `completion-publisher.ts` as private lane-completion helpers that always create draft PRs and run harness body refresh — not callable for a one-shot ready archive publication.

## Decisions

- Extract or export shared push and find-or-create/open-reuse PR primitives from `completion-publisher.ts` so other callers (cleanup) can invoke them with injectable `git`/`gh` seams.
- Add an archive-oriented path that creates a **ready** (non-draft) PR when none exists and reuses an existing open PR for the branch and default base without a second `gh pr create`.
- Archive-oriented push is lease-free; it does not acquire or release the lane completion push lease.
- Archive-oriented open-or-reuse PR skips harness PR body refresh and lane-history guards (one-shot title/body from the caller).
- `createCompletionPublisher` lane completion behavior stays draft-first with existing harness flip, body refresh, lane-history guards, and retry policy unchanged.

## Prerequisites

## Acceptance criteria

- [x] `completion-publisher.test.ts`: the archive-oriented push plus open-or-reuse PR path creates a ready PR once against the default base, reuses an existing open PR without a second create, and returns the PR URL; fails against current code (helpers private and lane path draft-only).
- [x] `completion-publisher.test.ts` `createCompletionPublisher` tests stay green (behavior unchanged by the extraction).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — lane completion publication semantics are unchanged; cleanup operator docs land in the dependent intent.

## Primary implementation surface

- `v2/src/execution/completion-publisher.ts`
