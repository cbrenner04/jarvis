---
name: publication-resolves-open-draft-pr-for-branch
---

# Publication resolves an open draft PR for the branch, or opens a fresh one

Multi-subspec specs route every subspec through one branch, so once subspec N-1's PR is merged or closed, subspec N's publication resolves that dead PR and calls `gh pr ready` on it — settling `ready_flip_failed` ("Only draft pull requests can be marked ready"), `resumable: false`, with complete gate-green work holding no PR. Reproduced 2026-09-12 on `20260912T152453Z-classify-and-checkpoint-gate-refusals` against merged #3804. `defaultGhReadyFlip` (`v2/src/execution/ready-finalize.ts:1107`) still resolves by branch with no state filter.

Behavior: PR resolution for a branch keys off open/draft state, never most-recent match. A branch whose only matching PRs are merged/closed opens and readies a fresh draft; an existing open draft is reused unchanged; an unexpected open non-draft fails with a named actionable error rather than the raw GitHub string, so the `ready_flip_failed` raw-string terminal is unreachable for closed-PR shapes. Covers every `defaultGhReadyFlip`-family call site. Scope to the publication PR-resolution seam — no change to branch reuse.

## Prerequisites

- Completion publication lists branch PRs by state (`gh pr list --head <branch> --state ...`) in `v2/src/execution/completion-publisher.ts`.
- The ready finalizer flips a draft PR to ready through the `ghReadyFlip` seam in `v2/src/execution/ready-finalize.ts`.
