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

### Half 1 verified, not reaped (2026-09-11)

The counter-evidence is resolved against Half 1, not for it. Two standalone implement lanes settled `completed` / `not-live` with **no `prNumber` and no `prUrl` on the durable row**, real commits on the branch, and nothing pushed:

| Branch | Commits ahead of `origin/main` | On origin | PR |
| --- | --- | --- | --- |
| `20260911T142243Z-pipeline-list-rpc-terminal-retention` | 1 | no | none |
| `20260910T231922Z-provisional-skip-provenance-in-state-store` | 4 | no | none |

Both were acceptance-complete at settlement (8/8 and 10/10 + 9/9; the only unticked boxes were in the informational `## Task checklist`). This follows four for four on 2026-09-10, so the mode is reproducible across sessions, models and specs — it is not environmental.

**The narrowing that matters: it is specific to the implement stage.** In the same session, on the same daemon, `intent` and `plan` stages published normally and ready-flipped — [#3778](https://github.com/cbrenner04/jarvis/pull/3778), [#3780](https://github.com/cbrenner04/jarvis/pull/3780), [#3781](https://github.com/cbrenner04/jarvis/pull/3781), [#3782](https://github.com/cbrenner04/jarvis/pull/3782) (intent) and [#3783](https://github.com/cbrenner04/jarvis/pull/3783) (plan). So `git`, `gh`, `origin`, auth and the publication primitives are all working; only the implement completion tail fails to reach them. Combined with 2026-09-10's finding that every durable row on such a branch is an `implement~link-N` whose log ends at `loop_finished` with no publication trace, the successor-dispatch gap named in this half's first acceptance criterion is the live hypothesis.

This also silently violates the completion-honesty contract, under which a `completed` implement implies confirmed PR evidence — so the row is not merely unhelpful, it is untrue.

## Acceptance criteria

- [ ] Half 1 root cause recorded (successor-dispatch gap, chain omission, or environmental), then: a `completed` implement with unpushed committed work publishes or settles a named failure, pinned by a test failing against silent local-only completion — or this half is reaped with the counter-evidence cited.
- [ ] A publication whose branch has only a merged/closed matching PR opens and readies a fresh draft, pinned by a test failing against resolve-most-recent (covers every `defaultGhReadyFlip`-family call site).
- [ ] An open draft on the branch is still reused; the raw `ready_flip_failed` GitHub-string terminal is unreachable for closed-PR shapes.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — standalone publication contract; PR resolution keys off open/draft state.
- `v2/docs/operator-runbook.md` — retire the hand-publish stopgap bullets when shipped.
