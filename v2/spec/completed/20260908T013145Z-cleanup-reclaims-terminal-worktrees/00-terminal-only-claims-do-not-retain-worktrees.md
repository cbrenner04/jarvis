# 00 - Release terminal-only durable claims from merged-worktree eligibility

## Problem

On main, merged-worktree eligibility and apply-time recheck already exclude terminal durable rows (`checkEligibility`, `revalidateMergedBranchRefCandidate`); operator docs still need explicit terminal-claim reclamation wording and a preservation pin so a future seam cannot reintroduce perpetual terminal ownership.

## Decision ledger

- Only non-terminal durable rows or daemon-live rows retain `(project, branch)` ownership for merged-worktree eligibility and apply-time recheck; rules out perpetual ownership by completed, failed, or killed rows reachable through any cleanup ownership or live-held seam today.
- Terminal durable rows may still resolve spec identity for post-retirement archival in the same invocation; rules out refusing archival solely because the only matching run row is terminal.

## Work

- Audit merged-worktree eligibility, apply-time recheck, ref-prune ownership, and post-retirement archival paths; confirm they still match the non-terminal-or-daemon-live contract (no behavior change expected on main).
- Align `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` with the existing gate.

## Acceptance criteria

- [x] `v2/src/commands/cleanup.test.ts` test `retires before archiving a complete durable spec and prunes only its consumed intent` stays green (terminal `completed` durable row still supplies spec identity for post-retirement archival).
- [x] `v2/docs/operator-runbook.md` documents that terminal durable rows do not retain merged-worktree eligibility while still supplying spec identity for archival.
- [x] `v2/docs/v1-behaviors.md` records the terminal-claim reclamation contract for merged-worktree cleanup.

## Documentation updates

- `v2/docs/operator-runbook.md` — terminal-claim reclamation under merged-worktree retirement eligibility.
- `v2/docs/v1-behaviors.md` — terminal durable rows do not retain merged-worktree ownership.
