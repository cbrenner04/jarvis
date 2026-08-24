# TUI & pipeline continuation brief

Successor to `tui-command-center-brief.md` (that phase shipped the unified work tree, attention segment, work/idle timing, detail pane, and left-pane framing). This brief tracks the **next** wave of TUI and pipeline work, sourced from a heavy 2026-08-16 operator dogfooding session that drove real fan-out pipelines through the TUI and hit the surfaces where the harness fights the operator.

**Scope:** every open TUI and pipeline seed as of 2026-08-16, excluding the operator's in-flight dogfood work (the `rename-pipeline-lane-*` intents, `pipeline-fan-out-*-lanes` seeds, `configure/retire/settle-*` and `v2-init-command`/`distinguish-jarvis-commit-steps`/`review-commits-*`/`pipeline-list-human-readable` specs). Each row is its own `jarvis run workflow intent` (or `pipeline start --seed`). This doc is the phase tracker: tick as work lands.

## The through-line

Dogfooding surfaced one dominant theme: **the harness has no good story for recovering a pipeline once anything goes wrong.** A blocked stage is a dead end, stale runs and pipelines never leave the display, and the TUI's attention surface buries the one thing that needs the operator under dozens of dead incidents. The pipeline items below are not polish — without stage-recovery, pipelines are, in the operator's words, "dead in the water," because a blocker is inevitable and today it is terminal.

## Pipeline work (priority-ordered)

Two clusters: **recovery** (make a blocked/failed pipeline survivable) and **fan-out correctness** (make a multi-lane pipeline actually publish). The recovery cluster is the blocker — nothing about pipelines matters until a blocker is survivable and a redraft can succeed.

### Recovery cluster (P0 — do first, co-plan as one surface)

| Seed | Delivers | Why P0 |
| --- | --- | --- |
| `plan-draft-harness-blocker-survives-redraft` | The harness-appended plan-draft `## Blocker` is cleared before/after a redraft, so a corrected redraft that passes the normalizer actually completes | **Root cause of the session's recurring plan-block loop.** Today a stale harness blocker survives into the next attempt and re-fails a *passing* redraft via `plan.draft.blocker` (`hasGenuineBlocker` sees seed + stale blocker) — so plan re-runs simply don't work. Fixing this makes re-run viable at all. |
| `plan-draft-blocker-append-creates-bare-spec-file` | A `plan.draft.blocker` miss routes the blocker to the staged intent, not to the durable spec-*directory* path (where `appendFileSync` creates a bare 4-line file the spec dir can never be created over) | Root cause of the bare-spec-file / staging leak this session (the `.jarvis-plan-stage`-to-main incident cleaned up in #2862/#2863 is the same class). |
| `pipeline-stage-recoverable-after-blocker` | Operator fixes a blocked stage's staged artifact in place and re-runs **that stage** (re-validate + continue, per branch), instead of the current `resumable:false` dead end | The operator-facing half: even once redraft works, the operator needs a deliberate per-branch recovery verb. "Pipelines are dead in the water" without it. |
| `branch-scoped-pipeline-resume` | `pipeline resume <id> [<branch-key>]` replays one branch's failed stage past sibling gates | The replay half (vs the fix-and-continue half above). Whole-pipeline resume today no-ops on any sibling awaiting gate. |

**Dependencies (now satisfied):** the two `plan-draft-*` seeds touch the same `write-loop.ts` blocker-append path the guard-reprompt trio rewrote — `plan-draft-blocker-append-creates-bare-spec-file` was gated on the persist spec (`20260816T204827Z-persist-guard-checkpoint-reprompt-context`) and `plan-draft-harness-blocker-survives-redraft` on the other guard-trio spec; **both guard specs merged this session, so both are unblocked** and should plan against the post-trio `write-loop.ts`.

**Concrete payoff:** the operator's real pipeline `22041e31` (seed `pipeline-terminal-settlement-supersedes-mid-stage-prs`) is parked on exactly this cluster — a blocked plan stage it cannot recover. It stays parked until `pipeline-stage-recoverable-after-blocker` lands, then resumes. This cluster is not hypothetical; it is unblocking live work.

### Recovery cluster COMPLETE (2026-08-18)

**The P0 recovery cluster is fully landed.** A blocked pipeline stage is now survivable end-to-end from the operator CLI — the "pipelines are dead in the water" problem is closed.

- `plan-draft-harness-blocker-survives-redraft` — **DONE** (#2879).
- `plan-draft-blocker-append-creates-bare-spec-file` — **DONE** (#2888).
- `branch-scoped-pipeline-resume` — **DONE**: state-store (#2880), orchestration (#2889), daemon RPC (#2894), and the CLI `jarvis pipeline resume <id> [<branch-key>]` (#2904, hand-finished — the plan blocked 3× on the normalizer).
- `pipeline-stage-recoverable-after-blocker` — **DONE**: execution foundation (#2891), branch-scoped daemon recovery (#2895), and the operator CLI `jarvis pipeline recover <id> <branch-key>` (#2906).

`heavy-daemon-agent-tests-flake-under-ci-concurrency` — **DONE** (#2900, the "no-co-runner lane" — `workflow-runner.test.ts` + `daemon-resume.test.ts` isolated). Full-suite CI now passes first-try; the ~44% red-gating is fixed. Subspec 01 (budget-margin derivation) deferred as over-build (its empirical per-file measurement blew the implement's iteration budget); the other 3 flake ready-intents appear unneeded now the fix holds. Seed consumed.

Also landed this session: v2-init (#2890), TUI pane divider (#2901), ready-gate-reaps 01+02 (#2903 — spec complete), and the 8-spec `completed/` archival (#2905).

### Next priorities (re-prioritized 2026-08-18; landings marked 2026-08-21)

1. ~~**`plan-normalizer-honors-declared-single-surface`**~~ — **DONE 2026-08-21** (subspec 01 #2925 atop subspec 00 #2910; spec complete). The intent split now emits the `Unsplit rationale:` + `## Primary implementation surface` declaration pair the normalizer honors, so the single-surface false-positive no longer blocks plans. Existing pre-fix intents still need the pair hand-added (operator declarations #2924/#2930/#2933/#2937 did this for the terminate/dismiss chains).
2. **TUI P1s** — `tui-stage-run-duplicated-as-top-level` **DONE 2026-08-24** (#2959, `tui-branch-aware-stage-run-attribution` — branch-aware `(project,branch)` attribution, driven through a `full-review` pipeline then hand-published when the implement stage died on quota). `tui-attention-segment-suppresses-stale-terminal-incidents` **STILL OPEN — top remaining TUI priority.**
3. **Pipeline display hygiene P2s** — `operator-dismisses-pipelines-from-display` **DONE 2026-08-21** (store #2932, rpc #2935, cli #2938/#2940, tui #2942/#2943) and `operator-terminates-stale-nonactive-runs` **DONE 2026-08-21** (daemon force-settle on `kill` #2927, `jarvis run kill --force` #2929). The `jarvis run dismiss` mirror (the noted gap — standalone terminal ad-hoc runs had no dismiss analog) is **DONE 2026-08-24** as the full `operator-dismisses-runs-from-display` chain: durable flag #2955, rpc #2962, cli #2966, tui-display #2968. `pipeline-list-display-retention` **still open**.
4. **Fan-out correctness P1** — still gated on the operator's `configure-pipeline-supersede-policy` landing first.
5. `distinguish-jarvis-commit-steps` **DONE 2026-08-21** (#2919/#2920/#2921, all three subspecs; the hollow `@mutate` checkpoints were re-authored by the implementing agent and hand-verified — the prior session's repair-draft was never persisted). **Still open:** dock grammar (`tui-dock-command-grammar-mirrors-cli`) and `tui-typed-run-steering-clears-command-input`.

New seed this session: `harness-publication-push-uses-explicit-refspec` — the completion step's bare `git push` fails when the implement branch tracks a differently-named upstream (e.g. from `--base origin/main`), stranding publication; an explicit `git push origin HEAD:<branch>` is robust to branch upstream config. See `v2/spec/seeds/`.

### 2026-08-24 session (CI fix, double-print, explicit expansion, run-dismiss, chess-dogfood)

TUI/pipeline landings: **double-print DONE** (#2959, above) and **run-dismiss chain DONE** (#2955/#2962/#2966/#2968, above). New TUI fix landed: **`tui-navigation-never-auto-expands-collapsed-nodes`** (#2965) — `j`/↓/↑ walk only the persisted-expansion tree; a collapsed node is one stop, never descended into, so expansion is fully explicit via `e`/`expand`/`collapse` only (removes `selectNextRun`'s reveal-on-navigate branch that #2922's reveal-for-paint left behind — the operator wanted no automatic expansion at all).

**⚠️ TOP INFRA PRIORITY — the `workflow-runner.test.ts` per-file agent-budget flake is back and now blocking, tracked as open issue #2181.** `heavy-daemon-agent-tests-flake-under-ci-concurrency` (#2900) isolated the file into `LOAD_SENSITIVE_FILES` (no co-runners), but it is a ~224-test/12K-line file *at the edge* of the 180s `PER_FILE_TIMEOUT_MS` (`scripts/run-v2-tests.ts`) even isolated. This session it red-gated the `Test (v2)` job on several PRs (#2962, #2980 — each cleared by one bare re-run), and then **hard-blocked** `ready-gate-failure-detail` (#2981, drafted): its 2 added resume-path tests tip the file *deterministically* over 180s (two straight ~5m55s timeouts), so it cannot merge without re-red-gating `main`. **Handle #2181**: raise the per-file agent budget and/or split `workflow-runner.test.ts` (and peel resume-path tests into their own `LOAD_SENSITIVE` file). Until it lands, any spec that adds an agent test to `workflow-runner.test.ts` risks the same wall. Related recurring seed target.

**Publication gap seeded (#2958) — `implement-completion-publishes-despite-no-work-shrink`.** Root-caused the recurring "implement completes the spec but publishes no PR": the completion tail gates push + `gh pr create` on a fresh tail `commitSha` (`workflow-runner.ts:1035`), so a no-work post-implement shrink over real commits falls through the silent no-op at `:1003-1034` to the terminal `complete` return, leaving the branch unpushed. Hit on **every** standalone `run workflow implement` this session (durable-flag, rpc, cli, tui-display, branch-aware, all node_modules + ready-gate implements) — each hand-published (`git push origin HEAD:<branch>` + `gh pr create`). This is the #1 friction of the session and the prior one; high-leverage.

**Pipeline recovery gap seeded (#2960) — `pipeline-stage-stuck-running-after-failed-run`.** A pipeline stage whose run terminates `failed` (quota/invocation) is not settled to `failed`; it stays `running`, the pipeline stays `running`, and `pipeline resume` refuses `pipeline_not_resumable` — no recovery path. Hit when the double-print `full-review` implement stage died on quota; the completed work was hand-published and the pipeline dismissed. Quota failure mid-stage is normal here, so this must become recoverable.

**Chess-mvp-yolo dogfood (external non-JS repo) surfaced two harness gaps, both worked to code:** **#2954 CLOSED** (`node_modules` symlink: conditional #2973 + never-rogue landing #2977 + names-the-cause #2980) — the unconditional worktree `node_modules` symlink poisoned intent landing on a repo without a `.gitignore`; **#2957 partial** — v2 ready gate now honors `projects.<key>.readyCommand` (#2976, was hardcoded `bun run ready`, ignored on non-JS projects); its `failure-detail` refinement is #2981 (blocked on #2181 above), and `skip-repair` + `markdown-skip` stay queued behind it (`v2/spec/ready-intents/`). Note: **codex-led plans blocked repeatedly with over-cautious cross-intent dependency `## Blocker`s and plan-normalizer `contract_miss` on compound ACs** — hand-published the drafts (the normalizer only gates the automated `plan` workflow, not manual PRs or `implement`).

### Fan-out correctness (P1)

**Dependency:** both fan-out seeds require the operator's `configure-pipeline-supersede-policy` ready-intent to **land first** (it introduces the pipeline-supersede config these build on). Then plan them in this order:

| Order | Seed | Delivers | Why |
| --- | --- | --- | --- |
| 1 | `pipeline-fan-out-per-lane-terminal-settlement` | Terminal publication runs **per lane**, so a fan-out whose lanes all succeeded settles `succeeded` and flips/merges each lane's PR | Today `resolveTerminalPublicationInput` returns "multi-branch terminal publication is not defined," committed as `terminalPublicationFailure`, so **every fan-out derives `failed` even when all lanes succeed** and the operator hand-publishes each lane. Major — this is why dogfooded fan-outs read `failed`. |
| 2 | `pipeline-fan-out-lanes-serial-chained-bases` | Fan-out lanes run **serially** by default, each lane's plan/implement chained off the previous lane's implement branch, honoring dependency order | Seed splits are usually dependent; today every lane bases off `main` and sees no sibling's work, so a later lane re-invents or conflicts. Matches the operator's dependency model (ordered `approve-intent` per lane). |

### Display hygiene (P2 — cluster, plan together)

| Seed | Delivers |
| --- | --- |
| `pipeline-list-display-retention` | Cap terminal pipelines to newest-N like runs; `--since`/`--all` for history; data retained (dogfooding reached 26 unbounded pipelines) |
| `operator-dismisses-pipelines-from-display` | `jarvis pipeline dismiss <id>` hides a pipeline from all surfaces via a durable flag (no delete); `--all`/`undismiss` to see |
| `operator-terminates-stale-nonactive-runs` | Force-settle a `paused`/unresumable run to terminal so it ages out; and/or startup reconciliation (stuck `unsupported_resume_context` runs are unresumable *and* unkillable today) |

## TUI work (priority-ordered)

| P | Seed | Delivers | Notes |
| --- | --- | --- | --- |
| **P1** | `tui-attention-segment-suppresses-stale-terminal-incidents` | Attention segment surfaces only actionable-now incidents; old terminal failures suppressed by recency; a stale-gate backlog can't crowd the current gate out of the 6-cap | Highest TUI impact: dogfooding showed `Needs attention (50)` (48 dead runs) burying the one live gate, which then wasn't even reachable. |
| **P1** | `tui-stage-run-duplicated-as-top-level` | A run belonging to a pipeline stage nests under it, never doubling as a top-level ad-hoc row (branch-aware attribution) | Correctness/legibility: confirmed with a distinct same-branch invocation (`1c65481a` recorded vs `f900c104` leaked). |
| **P2** | `tui-dock-command-grammar-mirrors-cli` | Dock verbs mirror the CLI minus `jarvis` (`pipeline start`, `run kill`, …) instead of the bespoke set | Big usability win (operator drove the dock like a shell and it rejected the CLI grammar); larger change — decide selection-vs-explicit-id coexistence. |
| **P2** | `tui-typed-run-steering-clears-command-input` | Typed `kill`/`pause`/`resume-run` clear the input like every other verb; the `start` arm catches a thrown admission instead of vanishing silently | Two small confirmed dock-submit bugs. |
| ~~P3~~ **DONE** | `tui-down-arrow-reveals-without-persisting-expansion` | ↓/`j` reveal-for-paint without persisting expansion; only `e`/`expand` persist | **DONE 2026-08-21 (#2922)** — `selectNextRun` descends via a throwaway `revealState` fed only to `monitorSelectableNodeIds`, never persisting expansion. **Reversed** by `tui-navigation-never-auto-expands-collapsed-nodes`: down and up had come to disagree (down entered a subtree up never re-entered); expansion is now fully explicit via `e`/`expand`/`collapse`, not symmetrically auto-revealed by navigation. |
| **P3** | `tui-left-right-pane-divider` | A painted vertical divider between the two split-layout panes | Visual polish; the panes currently run together. |

## Recommended ordering

1. **Recovery cluster (P0)** — ✅ **COMPLETE (2026-08-18).** See "Next priorities" above for the current ordering; the list below is superseded by it and kept for the P1/P2/P3 detail.
2. **Fan-out correctness (P1)** — `pipeline-fan-out-per-lane-terminal-settlement` (fan-outs currently always read `failed`) then `pipeline-fan-out-lanes-serial-chained-bases`. Independent of the recovery cluster; gated on the operator's `configure-pipeline-supersede-policy`.
3. **TUI attention + stage-doubling (P1s)** — the two highest-friction TUI defects; independent of the pipeline chains, run in parallel.
4. **Pipeline display hygiene (P2s)** — retention + dismiss + stale-run termination; a cluster, plan together.
5. **Dock grammar (P2)** — high value but a larger, standalone redesign; sequence after the P1 defects.
6. **TUI polish (P3s)** — down-arrow expansion and the pane divider; lowest urgency.

With the recovery cluster done, `plan-normalizer-honors-declared-single-surface` **landed 2026-08-21** (#2925) — plan drafting is no longer silently defeated by the single-surface false-positive. The single highest-leverage remaining fix is now the **TUI P1 pair** (`tui-attention-segment-suppresses-stale-terminal-incidents` + `tui-stage-run-duplicated-as-top-level`).

Test strategy unchanged: pure functions + injected input hook, no rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy); daemon/state tests for the pipeline items.

## Also open, outside this brief's scope

Non-TUI/pipeline harness work still queued (from the prior session's plan, not dogfooding): the **reap chain** (`20260811T063011Z-ready-gate-reaps-test-children`) is now **DONE** — subspec 00 shipped in #2884 and 01+02 in #2903 (the anticipated byte-identical `@mutate` anchor problem did not materialize). The **`daemon-start-sweeps-orphan-gate-children`** ready-intent remains queued; it belongs to the reap/test-hygiene line, not this brief.
