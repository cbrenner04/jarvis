# Seed split factors and plan subspec counts

Measured 2026-08-31 from this repo's git history. Questions: how many ready-intents does a seed split into, and how many subspecs does a plan emit?

## Method

- Source: `git log --first-parent --diff-merges=first-parent --name-status` over full history. Squash-merged PRs mean one commit per landed workflow, so commit-level grouping is workflow-level grouping.
- **Split event** = a commit adding ≥1 `v{1,2}/spec/ready-intents/*.md`, grouped per target dir; the intent workflow lands all emitted intents in one publication commit. Split factor = files added.
- **Plan event** = a commit adding `v{1,2}/spec/<dir>/index.md`; subspec count = `NN-*.md` files added to that dir in the same commit. `index.md`, `intent.md`, and review artifacts (`verdict-plan.md` ×555, `verdict-patch.md` ×485) are excluded — only 7 non-`NN-` non-artifact files exist in all history, so the `NN-` rule is essentially exact.
- Mining at creation time means archiving to `completed/` hides nothing; disk state is not a source (and can't be — `completed/` says nothing about seed→intent).
- Era boundaries: `ready-intents/` began 2026-06-16 (v2) / 2026-06-23 (v1); `seeds/` began 2026-06-23. The pre-ready-intents `wip-intents/` workspace and May-era hand-authored spec dirs predate the seed flow; the former is excluded, the latter appear in plan stats under "other subjects".

## Seed → intents

| scope | n | min | p50 | mean | p90 | max |
|---|---|---|---|---|---|---|
| all | 438 | 1 | 2 | 2.04 | 4 | 19 |
| v1 target | 88 | 1 | 2 | 1.92 | 3 | 19 |
| v2 target | 350 | 1 | 2 | 2.07 | 4 | 16 |

Histogram: 1×209 (48%), 2×113 (26%), 3×70 (16%), 4×28 (6%), 5×7, 6×5, 8×2, 10×2, 16×1, 19×1. Total intents ever emitted: 893.

- Half of seeds don't split at all; 90% emit ≤4 intents. Monthly means: 1.82 (Jun, n=116) → 2.26 (Jul, n=218) → 1.83 (Aug, n=104); the July bump is the big-split era (`intent: split 19 intents` #1037, two 10-splits, two 8-splits). The v2 max of 16 (#2266) is a recovery commit bundling several splits lost to the review-boundary defect, not one seed's fan-out; the honest v2 single-seed max is 10 (#281, #1219).
- Seed consumption moved into the split commit over time: splits deleting exactly one seed in the same commit were 1/116 in June, 86/218 in July, 95/104 in August. Pre-August, seed files were mostly removed later by session/cleanup chore commits (283 seed deletions sit outside split commits), so seed→intent linkage via git is only reliable from ~July on.
- Flows: 513 seed files ever added, ~480 removed, 59 in backlog today; 893 intents emitted, ~889 removed, 15 in backlog. Counts don't net exactly — renames/retitles register as removals only.

## Plan → subspecs

| scope | n | min | p50 | mean | p90 | max |
|---|---|---|---|---|---|---|
| all | 837 | 0 | 1 | 1.54 | 3 | 21 |
| v1 target | 136 | 1 | 1 | 1.45 | 2 | 21 |
| v2 target | 701 | 0 | 1 | 1.55 | 3 | 8 |
| `plan:`-titled subjects | 722 | 1 | 1 | 1.52 | 3 | 8 |
| other subjects (hand/spec/misc) | 115 | 0 | 1 | 1.63 | 3 | 21 |

Histogram: 1×565 (68%), 2×163 (19%), 3×72 (9%), 4×20 (2%), 5×9, 6×4, 8×1, 21×1, 0×2. Total subspecs ever authored at plan time: 1,285 (+18 by later amendment).

- Two-thirds of plans emit exactly one subspec; 96% emit ≤3. **Decomposition happens at the intent split, not the plan** — the typical seed becomes ~2 intents of 1–2 subspecs each, matching the seed-splits-by-behavior / intents-into-manageable-subspecs convention.
- Monthly p50 is 1 every month since June; means 2.00 (May, hand-authored era) → 1.46 / 1.52 / 1.60 (Jun/Jul/Aug). The shape has been stable for three months.
- Outliers: 21 subspecs = `2026-07-05T05-26-04Z-mock-real-subprocess-tests` (v1, hand-authored); v2 max 8 = `20260730T043255Z-pipeline-durable-approval-and-reopen-state`. The two zero-subspec dir creations (both 2026-07-22) are hand-landed index-first commits.
- Post-creation amendments are rare: 7 dirs ever gained subspecs after their creation commit (+18 files), all July–August. The earlier plan-refine era amended dirs across commits, but that predates `NN-` subspec authoring, so it doesn't pollute these counts.
- 669/837 plan events delete a linkable ready-intent in the same commit; the rest are May-era hand dirs plus linking misses (rename detection doesn't always fire on `intent.md` moves).

## Composed: subspecs per seed

For the 314/438 splits whose every emitted intent links to a plan event: min 1, p50 2, mean 2.77, p90 5, max 29. Histogram head: 1×120 (38%), 2×77 (25%), 3×44 (14%), 4×30 (10%). Selection-biased low — big fan-outs are less likely to be fully planned and fully linked, and unlinked May–June history drops out entirely.

## Reproduction

`bun v2/docs/research/20260831T054351Z-seed-splits-and-plan-subspecs.ts` — parses `git log --name-status`, classifies split/plan events per the rules above, prints distributions, monthly trends, and flow counts. Reads live history; rerunning later drifts from this snapshot.
