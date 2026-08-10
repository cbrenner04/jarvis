# TUI command-center session report (2026-08-10)

Jarvis-on-Jarvis operator session driving `v2/spec/tui-command-center-brief.md`. Agent order: **codex-first → claude** for most of the session; switched to **claude-first** mid-session after codex `gpt-5.6-sol` started hanging on its API (0% CPU, no tokens), and finished on claude. **Reviews restored to `full-review`** — critic (`light`) on intent, `debate` on plan + implement — after the prior session had driven bare workflows with reviews off. Every merge additionally got an adversarial **subagent diff review** (one caught a real mistake — see below).

## Landed — 24 PRs (#2762–#2787)

**Implementation (features):**

| Seed | What | PR(s) |
| --- | --- | --- |
| 7 `tui-detail-pane-structure` | full spec — sections, branch-grouped roll-up, semantic artifacts | #2766 |
| 4 `tui-work-row-anatomy` → labels | role-first run rows + branch-labeled ad-hoc rows | #2767 |
| 1 `terminal-timestamps-on-daemon-wire` | full spec — `decidedAt` + terminal timestamps on the daemon wire (**seeds 5–6 unblocker**) | #2764 plan, #2768 impl |
| 5 → `status-line-work-counts` | honest `N running · N awaiting gate · N failed · N done` dock counts | #2770 |
| 4 → `fill-layout` | fill-width labels, real indent, ▼/▶ glyphs, grid removed | #2777 plan, #2782 impl |
| 5 → `segment-rows` | pinned attention row projection + render + navigate/target-detail | #2778 plan, #2783/#2784/#2785 impl |

**Seeds complete: 1, 2, 3, 4, 5 (status-line + segment-rows), 7.**

**Supporting:** rollback to original seeds #2762; segment-rows reset/re-plan #2776; seed-6 intent #2779; work-idle plan #2780; brief refresh #2786; open-work housekeeping (stale seed removal + archival) #2787. **Harness/feature seeds filed:** reap leaked ready-gate test children #2763; keystone `@mutate` directives #2775; ISO-8601 TUI timestamps #2781. **Runbook:** leaked-zombie gotcha + never-tolerate rule #2765/#2772.

## Remaining (planned, clean daemon)

- **Seed 5 `row-act-in-place`** — unblocked now that segment-rows shipped (ready-intent on main).
- **Seed 6 `tui-work-idle-time`** — planned (#2780); implement pending.

## Friction / harness bugs (dominant to minor)

1. **Leaked processes — the dominant drag all session.** Three `bun test` orphans aged 2–3 days pegged CPU, stretching debate reviews past 13 min, wedging publication steps, and causing repeated `harness_failure` plan failures. The operator agent cannot reap them (classifier blocks `kill`/`pkill`). Cleared only when the operator ran `pkill` by hand — after which the count had *grown* to 4 (this session's own wedged runs leaked more). A sibling problem surfaced at the daemon bounce: **eight week-old daemon processes** running from a retired Aug-2 worktree. Seed `reap-ready-gate-test-children-on-run-termination` (#2763); runbook #2765/#2772. **Misdiagnosis note:** the CPU-starvation slowness got mislabeled twice mid-session (once as codex quota, once resolved by a daemon bounce) before the true cause (a codex `sol` API hang vs. plain agent slowness) was isolated by CPU%.
2. **Keystone `@mutate` contract stranded implement repeatedly** — prose checkpoint comments containing the `@mutate` token, a target-ambiguous directive, and a genuinely hollow checkpoint (an overflow guard whose test never reddened). Recurred on every segment-rows subspec; hand-fixed each. Seed `keystone-criteria-need-linkable-mutate-directives` (#2775).
3. **Publication frequently emits no PR, and iterations wedge at the boundary commit** (agent finishes writing, harness never commits) — forced a hand-commit → push → subagent review → CI → merge on most implements. Some also failed the commit gate on a biome complexity/format check (hand-refactored/formatted past).
4. **Fan-out pipeline is not resumable** once a branch is hand-finished (`pipeline_not_resumable`) — drove seed 5's serial chain (status-line → segment-rows → row-act) via standalone workflows.
5. **Implements launched off a pre-merge base** carry base-divergence and must be rebased before merge or they revert intervening merges (caught twice by diffing before merge).
6. **The daemon re-keys after every merge** — steering (`run kill`, `pipeline resume`) hits the current source-digest socket while the daemon owning the runs is on a prior key; `run list` works via discovery but steering needs a bounce.

## Process wins

- The **subagent diff review caught a real error**: on segment-rows I misread a block as being on subspec 02 and ticked its (unimplemented) criteria; the reviewer flagged the missing tests/code before merge. Nothing hollow shipped — every mutation checkpoint was verified to redden and no stranded mutant reached main.
- The `full-review` pipeline *correctly* blocked seed 5/6 plans on the missing `decidedAt` wire dependency — a genuine dogfood validation of the gate.

## Cost

Operator (claude-opus-4-8): **$122.87** paid — 111.0k input / 621.7k output, 173.4M cache read. API 2h36m; wall ~19h20m. Jarvis agents (plan/implement/review on claude sonnet-5 / opus-5 via quota) are billed separately and **not** in this figure. Mirrored into the cumulative CSVs.
