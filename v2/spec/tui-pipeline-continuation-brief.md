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
| **P3** | `tui-down-arrow-reveals-without-persisting-expansion` | ↓/`j` reveal-for-paint without persisting expansion; only `e`/`expand` persist | Scrolling past collapsed nodes currently auto-expands each one. |
| **P3** | `tui-left-right-pane-divider` | A painted vertical divider between the two split-layout panes | Visual polish; the panes currently run together. |

## Recommended ordering

1. **Recovery cluster (P0)** — the whole pipeline story depends on it, and two of the seeds are the *root causes* of the plan-block loop this session hit repeatedly. Sequence within the cluster: `plan-draft-harness-blocker-survives-redraft` **first** (until a redraft can succeed, no recovery path helps), then `plan-draft-blocker-append-creates-bare-spec-file`, then the operator-facing `pipeline-stage-recoverable-after-blocker` + `branch-scoped-pipeline-resume`. Co-plan as one surface.
2. **Fan-out correctness (P1)** — `pipeline-fan-out-per-lane-terminal-settlement` (fan-outs currently always read `failed`) then `pipeline-fan-out-lanes-serial-chained-bases`. Independent of the recovery cluster; can run in parallel.
3. **TUI attention + stage-doubling (P1s)** — the two highest-friction TUI defects; independent of the pipeline chains, run in parallel.
4. **Pipeline display hygiene (P2s)** — retention + dismiss + stale-run termination; a cluster, plan together.
5. **Dock grammar (P2)** — high value but a larger, standalone redesign; sequence after the P1 defects.
6. **TUI polish (P3s)** — down-arrow expansion and the pane divider; lowest urgency.

If only one thing ships from this brief, it is **`plan-draft-harness-blocker-survives-redraft`** — it is the smallest fix with the largest unblocking effect, and every pipeline/plan re-run today is silently defeated by it.

Test strategy unchanged: pure functions + injected input hook, no rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy); daemon/state tests for the pipeline items.

## Also open, outside this brief's scope

Non-TUI/pipeline harness work still queued (from the prior session's plan, not dogfooding): the **reap chain** (`20260811T063011Z-ready-gate-reaps-test-children`, implement parked — subspec 01 needs a re-plan for the byte-identical `@mutate` anchor problem) and the **`daemon-start-sweeps-orphan-gate-children`** ready-intent. Tracked here only so they aren't forgotten; they belong to the reap/test-hygiene line, not this brief.
