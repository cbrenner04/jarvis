---
name: terminal-publication-records-ready-flip
---

# Harness ready flips record evidence

## Problem

Completion publication can refuse republication on a non-draft PR the harness flipped ready earlier, but nothing on the run row proves the harness flipped that PR.

## Behavior

Both harness flip sites — pipeline terminal publication (`terminal-publication.ts`) and implement completion ready finalization (`ready-finalize.ts`, the site that flipped #4216, #4191, #4227) — invoke the state-store ready-flip evidence write only after `gh pr ready` succeeds for the resolved PR number, using the branch and base ref, on the run row the `(project, branch, spec_ref)` lineage lookup scans. A failed `gh pr ready` leaves prior evidence unchanged and records none for this attempt.

## Acceptance criteria

- [ ] `ready-finalize.test.ts` and `terminal-publication.test.ts` each fail against the pre-fix path and pins evidence persistence after a successful flip and no persistence when the injected `ghReadyFlip` rejects.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — both flip sites record evidence after success.
- `v2/docs/state-store.md` — list both production writers; qualify line ~62 terminal-settlement wording.
- `v2/docs/write-behavior.md` — ready finalization records evidence after a successful flip.

## Prerequisites

- Run rows persist harness ready-flip evidence (PR number, branch, base ref, flip time) through the state store, and lineage lookup returns a prior row's evidence when branch, base ref, and PR number match the same spec/lane.
