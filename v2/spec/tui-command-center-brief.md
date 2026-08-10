# TUI command center — refinement brief

Successor to the retired `tui-overhaul-brief.md` (slices 1–6 shipped 2026-08-07, #2713). This phase makes the shipped TUI *legible and actionable*: dogfooding against real fan-out pipelines showed the mechanics work but the surface answers "what state exists" instead of "what needs me / what's moving / what happened". **Do not send this brief to `plan`** — each row in § Seeds is its own `jarvis run workflow intent` (or `pipeline start --seed`). This doc is the phase tracker: tick the table as work lands.

## Dogfood findings driving this phase (2026-08-07)

- Every pipeline row is labeled with the registry definition name (`full-review`) — rows are indistinguishable; seed identity only in the detail pane.
- Post-split, stages interleave across branches; the operator couldn't tell one seed had split into three intents. Dead rows everywhere: post-split `default` placeholders (always skipped) and satisfied gates.
- `7 active` counted six pipelines parked at gates for up to six days; nothing surfaced "waiting on you".
- Elapsed is wall clock: ~16m of stage work read `6d 5h`. Failed-before-start stages render blank elapsed (no `startedAt`); failed runs can miss `finishedAtMs` and tick forever.
- Indentation is a shipped no-op (padded cell) and expansion has no glyph — hierarchy invisible.
- The Unattributed segment made ad-hoc `run workflow` launches second-class: post-eviction rows unreachable by selection, finishless terminals unevictable.
- Detail pane is a flat null-including `key: value` dump; the artifact (`downstreamInputs` = the intent split) renders as one-line JSON.

Full analysis with annotated operator responses: session artifact `tui-command-center-review.md` (scratch, 2026-08-07).

## Design

One left-pane surface, three questions in priority order: **what needs me** (pinned attention segment), **what's moving** (running work first), **what happened** (terminals, newest first).

- **Unified work tree** — top-level nodes are pipelines *and* ad-hoc workflow invocations; the Unattributed segment and its FIFO die; everything rides full-flatten + scroll viewport. Order: running → awaiting gate → terminal (newest finish first) — **shipped**, see `00-three-bucket-top-level-ordering`.
- **Intent-branch subtree** — pipeline → pre-split stages → one node per fan-out branch → its stages. `default` placeholders and satisfied gates elided from the tree (full records stay in detail). Intent row shows `→ N intents`.
- **Row anatomy** — `indent · ▼/▶ · label (fill) · right-aligned status cluster` replaces the fixed 10-column grid. Pipeline label = seed slug. Selection by tone; `>` caret retired.
- **Attention segment** — pinned, capped 6 + `+N more`: awaiting/rejected gates, failed stages/runs, publication failures; selectable, `approve`/`reject` act directly. Status line becomes `N running · N awaiting gate · N failed · N done`.
- **Work/idle time** — elapsed on pipeline/branch rows = Σ stage durations ("work"); "idle" = time since last activity. Parked pipeline: `work 16m · idle 6d`. Wall clock retires to the detail pane.
- **Detail pane** — blank-line sections, branch-grouped stage roll-up, null suppression, semantic artifact rendering (intent list, spec path, PR), pretty JSON fallback.

Reference sketch (left pane, ~94 cols):

```
── Needs attention (7) ──────────────────────────────────────────
 ✋ approve-plan  tui-pipeline-tree › tree-model          idle 6d
 ✗ implement     tui-pipeline-tree › tree-monitor        idle 6d
 +5 more
── Work ─────────────────────────────────────────────────────────
▶ 20260807T1607-plan-intent…     intent · in-progress   21m live
▼ tui-pipeline-tree      full-review · ✋1 ✗1 · work 16m · idle 6d
    intent ✓ 2m52s → 3 intents
  ▶ list-poll                       implement pending · work 3m41s
  ▼ tree-model                      ✋ approve-plan · work 7m51s
      plan ✓ 4m59s
      approve-plan                  awaiting 6d
      implement                     pending
  ▶ tree-monitor                    ✗ implement · work 9m
▶ tui-tree-self-expand…  full-review · ✋1 · work 8m · idle 6d
```

Test strategy unchanged: pure functions + injected input hook, no rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Seeds

Dependency order; 1 and 2 are independent starting points; 5–7 in any order after their deps.

| # | Seed | Delivers | Depends on | State |
| --- | ------ | ---------- | ------------ | ------- |
| 1 | `pipeline-terminal-timestamps` | Terminal stages/runs always stamped; approval `decidedAt` on wire; failed-before-start shape pinned | — | re-decomposed → `terminal-timestamp-persistence` (store) + `terminal-timestamps-on-daemon-wire` (wire). Persistence **shipped** (#2747, #2749, #2752); **wire pending** (plan blocks; seeds 5–6 gate on it) |
| 2 | `tui-unified-work-tree` | Pipelines + ad-hoc in one tree; segment/FIFO deleted; uniform selection | — | **shipped** (#2745; ordering half #2732) |
| 3 | `tui-intent-branch-subtree` | Branch-grouped subtree; placeholder + satisfied-gate elision; stripped branch labels; intent yield | 2 | **shipped** (#2748, #2750) |
| 4 | `tui-work-row-anatomy` | Fill-width labels; seed-slug identity; real indent + ▼/▶; grid + tier table removed | 2, 3 | seed-slug pipeline identity and role-first run labels **shipped** from `20260809T025859Z-tui-work-row-labels`; fill-width labels, real indent, and ▼/▶ glyphs **pending** |
| 5 | `tui-attention-segment` | Pinned needs-me list + act-in-place; segmented status counts | 1, 2 | re-intent → `segment-rows` + `row-act-in-place` + `status-line-work-counts`; **pending** (gated on wire) |
| 6 | `tui-work-idle-time` | work/idle aggregation; failed-before-start rendering; frozen finishless display | 1, 3 | intented; **pending** (gated on wire) |
| 7 | `tui-detail-pane-structure` | Sections; branch-grouped roll-up; null suppression; semantic artifact | 3 | **shipped** by [`20260809T024443Z-tui-detail-pane-structure`](./20260809T024443Z-tui-detail-pane-structure/) |

State legend: seeded → intent #NN → planned #NN → **shipped** #NN (implementation PR). Update the row as each lands.

**Status (paused 2026-08-09).** Seeds 2, 3, and seed 1's store half landed cleanly. Seed 1 was re-decomposed by module surface (store `terminal-timestamp-persistence` shipped; daemon-wire projection pending — its plan blocks and seeds 5–6 gate on it). Seeds 4/5/7 were re-run through the intent stage (per operator: intents come from seeds, split intents run sequentially), yielding dependent sub-intents landed in order. Remaining work is mechanical but slowed by harness friction captured for seeding: leaked test-gate child processes that peg CPU and lock worktrees, `workflow-runner.test.ts` CI-timeout flake, and one-subspec-per-implement-run re-runs.

## Non-goals

- Command grammar changes (untested by the operator so far; revisit after dogfooding this phase)
- Split-ratio / divider rework (truncation pressure should drop with row anatomy; revisit if not)
- Pipeline kill/pause (unchanged from prior phase)
