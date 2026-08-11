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
| 1 | `pipeline-terminal-timestamps` | Terminal stages/runs always stamped; approval `decidedAt` on wire; failed-before-start shape pinned | — | re-decomposed → `terminal-timestamp-persistence` (store) + `terminal-timestamps-on-daemon-wire` (wire). Persistence **shipped** (#2747, #2749, #2752); wire **shipped** (#2764 plan, #2768 impl) — unblocked seeds 5–6 |
| 2 | `tui-unified-work-tree` | Pipelines + ad-hoc in one tree; segment/FIFO deleted; uniform selection | — | **shipped** (#2745; ordering half #2732) |
| 3 | `tui-intent-branch-subtree` | Branch-grouped subtree; placeholder + satisfied-gate elision; stripped branch labels; intent yield | 2 | **shipped** (#2748, #2750) |
| 4 | `tui-work-row-anatomy` | Fill-width labels; seed-slug identity; real indent + ▼/▶; grid + tier table removed | 2, 3 | **shipped** in full — seed-slug identity + role-first labels (#2755, #2767, `20260809T025859Z-tui-work-row-labels`) and fill-width labels + real indent + ▼/▶ glyphs (#2777 plan, #2782 impl, `20260810T012228Z-tui-work-row-fill-layout`) |
| 5 | `tui-attention-segment` | Pinned needs-me list + act-in-place; segmented status counts | 1, 2 | serial chain `status-line-work-counts` → `segment-rows` → `row-act-in-place`. `status-line-work-counts` **shipped** (#2770); `segment-rows` **shipped** (#2778 plan, #2783/#2784/#2785 impl); `row-act-in-place` **shipped** — subspec 00 dispatch approve/reject from attention rows (#2804), subspec 01 Enter-reveal core (#2815), and its split-out `tui-tree-reveal-collapsed-workflow-member` follow-on (#2821) |
| 6 | `tui-work-idle-time` | work/idle aggregation; failed-before-start rendering; frozen finishless display | 1, 3 | **shipped** by [`20260810T015227Z-tui-work-idle-time`](./20260810T015227Z-tui-work-idle-time/) |
| 7 | `tui-detail-pane-structure` | Sections; branch-grouped roll-up; null suppression; semantic artifact | 3 | **shipped** by [`20260809T024443Z-tui-detail-pane-structure`](./20260809T024443Z-tui-detail-pane-structure/) |

State legend: seeded → intent #NN → planned #NN → **shipped** #NN (implementation PR). Update the row as each lands.

**Status (2026-08-10) — PHASE COMPLETE.** All seven seeds shipped: 1 (persistence + wire), 2, 3, 4 (labels + fill-layout), 5 (`status-line-work-counts` + `segment-rows` + `row-act-in-place` incl. Enter-reveal + collapsed-member follow-on), 6 (`work-idle-time`), and 7 — driven `full-review` (critic on intent, debate on plan + implement) with an adversarial subagent diff-review on every merge. Feature seed `tui-timestamps-iso8601` (#2781) also shipped (#2805). Follow-on bug `tui-compact-timing-preserves-work` (found in review of seed 6) shipped (#2814).

## Next steps (open-work queue after this phase)

The TUI command-center phase is done; these are the durable follow-ons left in `v2/spec/{ready-intents,seeds}/`. **Two harness fixes from this session are now merged and (after a 2026-08-10 daemon restart) live**, which changes how the remaining items re-drive:

- **Mutation-checkpoint parser fix** (#2806) — a `//` comment must have `@mutate` as its first token to be a directive; prose *mentions* of the token no longer strand runs.
- **Plan-draft keystone gate** (#2822) — plan draft now *refuses* a staged tree whose keystone criterion is prose-only (not selectable by `selectKeystoneCheckpointCriteria`). Plans can no longer emit tick-but-never-verified keystones; a keystone criterion must carry the canonical `` `pinFile` — `pinTitle`; Keystone checkpoint: `` suffix.

Remaining queue after the 2026-08-11 session (which shipped `keystone-links-implement-authored-directive` and the reap chain's foundation):

**`keystone-links-implement-authored-directive` — DONE** (#2826 plan, #2827 implement). The implement now reprompts to author an unlinked *keystone* directive. The daemon was bounced mid-session on 2026-08-11, so #2827 is live — but the daemon re-keys after each merge, so a next session must first **confirm the daemon is up on current code** (`jarvis daemon status` should report `loaded == current` at `main`'s HEAD; bounce it from the operator shell if not) before any implement that needs implement-authored directives.

1. **reap chain (`#2763`) — partially landed, needs a dedicated session with a daemon restart first.**
   - `subprocess-process-group-kill` foundation **DONE** (#2829 plan, #2831 implement) — opt-in `processGroup` on the shared runner.
   - `ready-gate-reaps-test-children` **plan DONE** (#2832, 3-subspec tree); **implement PARKED** — wrote correct green code but stranded on unauthored `@mutate` directives (1 keystone + 2 guards) for subspec 01; worktree abandoned, re-run from scratch. **Subspec-01 caveat:** the gate and required-integration spawn sites in `ready-finalize.ts` share byte-identical option lines, so no unique single-line `@mutate` anchor exists — the re-plan must differentiate the two sites or target distinct source lines.
   - `daemon-start-sweeps-orphan-gate-children` ready-intent on main — plan+implement after the above (depends on the durable group-id record).
2. **TUI left-pane legibility (design-review follow-on, seed #2830 → intent #2833) — COMPLETE.** `tui-left-pane-section-framing` shipped (#2835 plan, #2836 impl): ruled `── Work (N) ──`/`── Queue (N) ──` headings and no `idle` atom on terminal runs. `tui-left-pane-width-and-timing-threshold` shipped (#2837 plan, #2838 impl): widened the left pane (base 0.45 / ceiling 0.5 / floor 80) and lowered the pipeline/branch timing threshold to 80 columns so ordinary terminals paint the labeled `work · idle` form. Subspec 01 was hand-finished (the subspec-by-subspec continuation can't resume). Section separation, pane width, and the confusing `idle`/cryptic-timing atoms are all addressed.
3. **`implement-reprompts-unlinked-guard-checkpoints`** (seed on main) — extend #2827's reprompt to unlinked/hollow **guard** checkpoints (keystone-only today); this blocked the reap subspec-01 implement.

**Next session must first confirm the daemon is running current code** (`jarvis daemon status` → `loaded == current` at `main`'s HEAD; the daemon re-keys after each merge and can drop to a stale build or report `stopped` against the current digest — bounce it from the operator shell if so). #2827 is only effective on a daemon running the post-merge build; otherwise every implement needing implement-authored directives strands (observed repeatedly this session).

Session detail (all PRs, the leaked-worker reproduction, and the parking rationale): see the `reports/2026081*` session reports.

### Friction observed this phase (mostly fixed above)

Fixed durably: the keystone `@mutate` strand class (parser #2806 + plan-draft gate #2822); the cross-socket TUI pipeline-row duplication (`mergePipelineSnapshots` now dedupes by `pipelineId`, #2803); the compact-timing work-drop (#2814). Still-open harness gotchas (no seed yet — one-offs unless they recur): the daemon **re-keys after each merge** (a workflow dispatch auto-bounces it; `daemon status`/`cleanup --abandon` otherwise report "stopped"/"no daemon" against the current-digest socket — use `--yes` for non-interactive cleanup); **publication frequently emits no PR / leaves the draft un-flipped** (`ready_gate_out_of_scope`, `completion_commit_failed`, `unsupported_resume_context`) — hand-finish: verify gate, subagent-review, push, mark ready, admin-merge; **`jarvis cleanup` archives moves but doesn't commit them** (commit the archival as a follow-on PR) and will archive an *incomplete* spec whose worktree merged (split the unfinished subspec to a seed and trim the spec first). The leaked-`bun test`-children seed (#2763) is folded into the reap item above.

## Non-goals

- Command grammar changes (untested by the operator so far; revisit after dogfooding this phase)
- Split-ratio / divider rework (truncation pressure should drop with row anatomy; revisit if not)
- Pipeline kill/pause (unchanged from prior phase)
