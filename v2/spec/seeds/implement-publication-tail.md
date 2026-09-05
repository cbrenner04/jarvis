---
name: implement-publication-tail
---

# The implement publication tail either publishes or fails loudly — never silently strands

Merges the former `implement-completes-without-publishing` and `implement-publication-reuses-closed-same-branch-pr` seeds (2026-09-05 compaction) — the never-dispatches and mis-resolves halves of one broken tail. The 2026-09-03 close status called the publication tail "where work is lost, not the authoring": every strand class here follows complete, gate-green work.

## Half 1 — completion without publication (verify-or-reap)

`run workflow implement` settles `completed` with the branch committed but never pushed and no PR — no error, no failed row. Evidence: 2026-08-29, three standalone implements all local-only, hand-published (#3086, #3087). **Counter-evidence 2026-08-30: all four standalone implements that session auto-published** — root-cause whether the successor-dispatch gap is real or was environmental before building. Decisions: a `completed` implement with committed, unpushed work either publishes (push + draft PR) or settles a named, operator-visible failure; if publication is genuinely a separate operator step somewhere, the docs and `run list` say so.

## Half 2 — ready-flip resolves a closed same-branch PR

Multi-subspec specs route every subspec through one branch, so subspec N's publication resolves subspec N-1's merged same-branch PR and fails `ready_flip_failed` ("Only draft pull requests can be marked ready") instead of opening a fresh draft. Evidence: 2026-08-29 run `949a26cb` (hand-published as #3069); **live again 2026-09-03**: a lane ready-flipped #3396 (a prior subspec's merged PR) and settled `ready_flip_failed` with its completed 5/5 work holding no PR. Related: `defaultGhReadyFlip` still resolves by branch with no state filter (#3449 fixed a different call site — 2026-09-05 audit).

Decisions: publication resolves the PR to flip by open/draft state, never most-recent match — a branch whose only matching PR is merged/closed opens a fresh draft; an unexpected open non-draft fails with a named actionable error, never the raw GitHub string; scope to the publication PR-resolution seam, no change to branch reuse.

## Acceptance criteria

- [ ] Half 1 root cause recorded (successor-dispatch gap, chain omission, or environmental), then: a `completed` implement with unpushed committed work publishes or settles a named failure, pinned by a test failing against silent local-only completion — or this half is reaped with the counter-evidence cited.
- [ ] A publication whose branch has only a merged/closed matching PR opens and readies a fresh draft, pinned by a test failing against resolve-most-recent (covers every `defaultGhReadyFlip`-family call site).
- [ ] An open draft on the branch is still reused; the raw `ready_flip_failed` GitHub-string terminal is unreachable for closed-PR shapes.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — standalone publication contract; PR resolution keys off open/draft state.
- `v2/docs/operator-runbook.md` — retire the hand-publish stopgap bullets when shipped.
