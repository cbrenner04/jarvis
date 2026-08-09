# TUI command-center session report (paused 2026-08-09)

Jarvis-on-Jarvis operator session driving `v2/spec/tui-command-center-brief.md`. Agent order: **claude only**. Reviews turned **off** partway (CPU starvation strangled the debate step; see Friction); implements still ran the full gate + mutation-checkpoint verifier, and the operator diff-reviewed each merge.

## Landed on main (implementation PRs)

| Seed | What | PR(s) |
| --- | --- | --- |
| 2 `tui-unified-work-tree` | three-bucket top-level ordering | #2732 |
| 2 `tui-unified-work-tree` | unified work tree; Unattributed segment/FIFO deleted | #2745 |
| 1 persistence | run finish timestamp on terminal run writes | #2747 |
| 1 persistence | terminal stage writes stamp `endedAt` | #2749 |
| 1 persistence | approval `decidedAt`; reopen clears it | #2752 |
| 3 `tui-intent-branch-subtree` | branch-grouped subtree | #2748 |
| 3 `tui-intent-branch-subtree` | elide satisfied gates + intent yield | #2750 |
| 4 `tui-work-row-anatomy` (labels) | seed-slug pipeline identity, role-first run rows (subspec 00) | #2755 |

**Fully complete seeds: 2, 3, and seed 1's store half.** Supporting merges (intent/plan/infra): #2733–#2744, #2751, #2753, #2756, #2734–#2736, #2739, #2759 (brief), plus the archival PR carrying this report.

## Pending (why the session paused)

- **Seed 1 wire** (`terminal-timestamps-on-daemon-wire`): plan blocks silently (review-off agent bailout; premise still valid — `runListTerminalFinishAtMs` on main still uses attempt/`reconciledAt`, not the new `finished_at`). **Gates seeds 5 and 6.**
- **Seed 4**: labels subspec 01 + `fill-layout` pending (labels-01 worktree lock; fill-layout lands after labels).
- **Seeds 5, 6**: intented (5 → `segment-rows`/`row-act-in-place`/`status-line-work-counts`), plans blocked on wire.
- **Seed 7** (`tui-detail-pane-structure`): subspec 00 implemented but **PR #2757 is conflict-dirty (unmerged)**; 01, 02 pending.

Main is green (latest commit passed CI). One transient red (#2756, a markdown-only commit) was the flaky `workflow-runner.test.ts` timeout, cleared by the next commit.

## Decisions / course corrections

- **Splitting seeds into (dependent) intents is the proven decomposition** — run dependent intents sequentially (base → land → dependent). Early in the session I mischaracterized this as over-splitting and hand-authored intents; corrected per operator, re-ran seeds 4/5/7 through the intent stage.
- Seed 1 (`pipeline-terminal-timestamps`) was too complex to plan as one intent (tripped the single-surface plan contract because it straddled persistence + daemon). Re-decomposed **by module surface**: `terminal-timestamp-persistence` (store, shipped) + `terminal-timestamps-on-daemon-wire` (daemon, pending). Lesson: intent AC/doc bullets classify by keyword (`persist`/`daemon`/…); keep each intent single-surface.
- Pivoted from parallel implements to **serialize** after parallel branches on shared TUI files started landing dirty conflicts (#2757).

## Friction / harness bugs (to seed)

1. **Leaked test-gate child processes.** `bun test` / `markdownlint-cli2 --fix` children leak (some 1–2 days old, PPID 1), pegging ~2 cores continuously (starving every agent) **and** holding worktree locks that block `cleanup --abandon` and re-runs. The single biggest drag all session; operator cannot reap them (`kill` blocked by the auto-mode classifier). Root cause candidate: `guard-sync-child-processes` not covering the implement/plan test gate.
2. **`workflow-runner.test.ts` CI-timeout flake** — intermittently times out (leaks the above), red-gating unrelated PRs (e.g. #2749 first run, #2756). Re-run clears it.
3. **One-subspec-per-implement-run** — a multi-subspec spec needs N implement runs; combined with the starvation (~40 min/run) this dominated wall-clock. Consider looping the implement over unchecked subspecs within one admission.
4. **Fan-out pipeline resume** refuses `multiple_failed_stages` when ≥2 branches fail — no in-harness recovery (early-session finding).
5. **`contract_miss` recurrence** on plan output — index-link completeness and multi-surface `## Documentation updates` bullets tripped repeatedly on the store/daemon-boundary intents.

## Cost

_/cost figures pending from operator — CSVs to be updated once provided._

## Follow-ups on resume

1. Reap the leaked test processes first (restores throughput + clears worktree locks).
2. Land wire (re-run its plan; if it re-blocks silently, plan with review on or hand-check the single premise), then seeds 5, 6.
3. Finish seed 4 (labels-01 → fill-layout) and seed 7 (01, 02); re-run seed 7-00 off latest main to clear #2757's conflict.
4. Seed the friction items above.
