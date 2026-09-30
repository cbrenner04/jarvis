---
name: terminal-publication-records-ready-flip
---

# Terminal publication records a successful ready flip

## Problem

Completion publication can refuse republication on a non-draft PR the harness flipped ready earlier, but nothing on the run row proves the harness flipped that PR.

## Behavior

The terminal publication ready path invokes the state-store ready-flip evidence write only after `gh pr ready` succeeds for the resolved PR number, using the publication branch and base ref. A failed `gh pr ready` leaves prior evidence unchanged and records none for this attempt.

## Acceptance criteria

- [ ] `terminal-publication.test.ts` fails against the pre-fix path and pins evidence persistence after a successful flip and no persistence when the injected `ghReadyFlip` rejects.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None; the ready-flip evidence write contract is documented in `v2/docs/state-store.md` (ready-flip-evidence-persistence).

## Prerequisites

- Run rows persist harness ready-flip evidence (PR number, branch, base ref, flip time) through the state store, and lineage lookup returns a prior row's evidence when branch, base ref, and PR number match the same spec/lane.
