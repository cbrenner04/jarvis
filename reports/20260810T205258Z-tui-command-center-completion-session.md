# TUI command-center completion session report (2026-08-10)

Jarvis-on-Jarvis operator session completing `v2/spec/tui-command-center-brief.md` (seeds 5–6) plus the open non-brief seeds. Agent order: **codex-first → claude**, but codex was **out of quota** from the start, so every run cascaded to **claude** (order flipped to claude-first mid-session to skip the wasted cascade). Posture: `full-review` (critic on intent, debate on plan + implement) plus an adversarial **subagent diff review on every merge** — one review caught a real latent bug, another correctly cleared a large refactor.

## Landed — 34 PRs merged (#2789–#2824), 2 closed (#2791/#2792)

The session ran in two halves: an initial completion push (through #2808), then a "keep going" continuation (#2809–#2824) that finished the Enter-reveal feature and landed the plan-layer root-fix for the strand class.

**Brief — now 100% complete:**

| Seed | What | PR(s) |
| --- | --- | --- |
| 6 `tui-work-idle-time` | aggregate work/idle projection, failed-before-start timing, finishless-terminal timing | #2797 impl |
| 5 `tui-attention-row-act-in-place` | subspec 00 dispatch approve/reject from attention rows (#2790 plan, #2804 impl); subspec 01 Enter-reveal core (#2811/#2813/#2815); split-out collapsed-member reveal (#2817/#2819/#2821) | see cells |

**Brief is fully complete** — the phase is marked done in `v2/spec/tui-command-center-brief.md`, which now carries a **Next steps** section (#2824) for the two remaining queue items.

**Non-brief feature/harness work driven this session:**

| Work | What | PR(s) |
| --- | --- | --- |
| `tui-timestamps-iso8601` (#2781) | ISO 8601 UTC absolute detail timestamps via a shared `formatAbsoluteTimestamp` helper | #2789 intent, #2799 plan, #2805 impl |
| `mutation-checkpoint-parser-...` | **durable fix** for the keystone-`@mutate` strand class — parser now requires the directive token in directive position, ignores prose mentions and lookalikes | #2793 reword, #2794 seed, #2795 intent, #2796 plan, #2806 impl |
| `tui-dedupe-pipeline-snapshots-across-sockets` | **fixed a live operator-reported broken TUI** — dedupe pipeline snapshots by `pipelineId` across daemon sockets | #2800 seed, #2801 intent, #2802 plan, #2803 impl |

**Continuation round (#2809–#2824):**

| Work | What | PR(s) |
| --- | --- | --- |
| `tui-compact-timing-preserves-work` | compact tree-timing cell now preserves work and elides idle (was left-clipping work); found in review of seed 6 | #2809/#2812/#2814 |
| `tui-attention-row-enter-reveal` (core) | tree-focus Enter reveals the selected attention row's target; re-scoped to core after the intent decomposed into a dependent pair (collapsed-member split out, #2810) | #2811/#2813/#2815 |
| `tui-tree-reveal-collapsed-workflow-member` | collapsed non-representative workflow member materializes as its own painted row — finishes Enter-reveal | #2817/#2819/#2821 |
| `plan-draft-rejects-unsatisfiable-keystone` | **plan-layer root fix** (#2775 half): plan draft now refuses a prose-only keystone criterion not selectable by `selectKeystoneCheckpointCriteria` — plans can no longer emit tick-but-never-verify keystones | #2818/#2820/#2822 |

**Seeds filed / queue:** `tui-compact-timing-preserves-work` (#2798, from a subagent-review find — then shipped), `tui-tree-reveal-collapsed-workflow-member` (#2810 — then shipped); still queued: `keystone-links-implement-authored-directive` (ready-intent) and `reap-ready-gate-test-children-on-run-termination` (seed). **Housekeeping:** row-act spec trimmed + Enter-reveal split to seed (#2807); completed specs archived across three rounds (#2808, #2816, #2823); brief marked complete with next steps (#2824). Reap `full-review` pipeline settled **rejected** (persist branch stranded, branches 2/3 rejected); stage PRs closed (#2791/#2792).

## Two problems the operator flagged mid-session — both fixed durably

1. **The mutation-checkpoint parser bug (root of this session's repeated `contract_miss` strands).** `COMMENT_DIRECTIVE_LINE = /^\s*\/\/.*@mutate/` matched `@mutate` *anywhere* in a `//` comment, so prose `Keystone checkpoint:` comments mentioning the token were misparsed as malformed directives and hard-blocked the run. Reworded the 5 offending prose comments on main for immediate relief (#2793), then drove the durable fix (#2806): the gate now requires `@mutate` in directive position with a token boundary. Subagent review swept the whole repo and confirmed **no regression**. **Takes effect only on daemon restart** — the running daemon still has the old parser.

2. **Broken `jarvis tui` (operator-reported): reap pipeline row duplicated, navigation trapped.** Diagnosed with a **pure-function render harness** driving live daemon state: not bad data (21 distinct pipelines) but **two live daemons** (a re-key drain left a stale one) whose sockets the TUI merged — and `mergePipelineSnapshots` concatenated without dedup while its sibling `mergeRunLists` deduped runs by `runId`. Every pipeline rendered twice with the *same* node id → both highlight on select, navigation cycles. Fixed by deduping snapshots by `pipelineId` with a deterministic collision winner (#2803). The two daemons self-reaped when their runs finished, so the duplication also cleared environmentally; the fix makes it robust on the next `jarvis tui` launch.

## Deferred (captured in the brief's Next steps + queue)

- **`keystone-links-implement-authored-directive`** (ready-intent on main, the second half of #2775) — lets the implement author-and-link a keystone directive from criterion text (closes the greenfield case). Its plan drafted clean (canonical keystones — the new gate + parser worked) but the run hit the publication-emits-no-PR friction; re-drive `plan`, then implement. **Its implement modifies the core write-loop reprompt/completion contract — do it as its own focused session.**
- **`reap-ready-gate-test-children-on-run-termination` (#2763)** — deep 3-subspec harness overhaul (state-store persistence + execution-loop reaping + daemon-start orphan sweep). Dogfooded a full `full-review` **pipeline**: intent split cleanly into 3 dependency-chained intents, but the persist branch's plan **over-absorbed** the whole feature and its implement stranded on the prose keystone. Pipeline settled **rejected**; seed preserved on main. Drive as a serial standalone chain (persist → reap-on-termination → sweep), not one pipeline.

Seed 5 subspec 01 (Enter-reveal) was itself deferred earlier in the session — the implement thrashed 75 min in a reprompt loop on its prose keystone without writing code; killed it, landed subspec 00, split 01 to a seed (#2807) — then **completed in the continuation round** (#2811/#2813/#2815 core + #2817/#2819/#2821 collapsed-member), flowing cleanly once the parser fix was live.

## Friction / harness observations

1. **Keystone `@mutate` strands, again — the dominant drag.** Stranded work-idle-time, dedup, row-act 01, and reap-persist implements this session. Root-caused and fixed durably (#2806); until a daemon restart, prose-only keystones in a plan still strand claude-authored implements (codex embeds literal directives; codex was out all session). Hand-finish recipe proven repeatable: author + link the `// @mutate` directive on the enclosing test, verify it turns the test RED and restores GREEN, then publish.
2. **Pipeline fan-out can't model a coherent-feature seed.** Two independent failure modes on the reap seed: (a) it can't **sequence dependent branches** (branches 2/3 stack on the intent branch, never see branch 1's merged interface); (b) per-branch planning **over-absorbs** sibling scope (the persist plan became the whole feature). Both stem from fan-out assuming independent intents.
3. **Publication emits no PR / draft not flipped.** work-idle-time's first chain committed subspec 00 but published nothing (a successor run continued — do not conclude "skipped", check for the successor). iso8601 and parser-fix implements finished complete but stayed **draft** (intermediate `ready_gate_out_of_scope` / `completion_commit_failed` runs, likely CPU contention from two concurrent implements) — hand-flipped ready + admin-merged after review.
4. **The daemon re-keys after every merge.** `daemon status`/`cleanup --abandon` hit the current-digest socket (reports "stopped"/"no daemon listening") while the running daemon is on a prior key; a workflow dispatch auto-bounces it, `run list`/`cleanup` work via discovery. `cleanup --abandon --yes` and `cleanup --yes` are **non-interactive** (corrects the "cleanup needs a TTY" lore — the `--yes` flag suffices).
5. **`jarvis cleanup` archives moves but doesn't commit them, and archives an incomplete spec whose worktree merged.** The archival file-moves land uncommitted in the primary checkout (committed here via #2808). And the row-act spec (subspec 01 unfinished) was queued for archival because its worktree merged — protected by splitting 01 to a seed and trimming the spec first.

## Process wins

- The **render harness** (`.scratch/render-tui.ts`, transient) is the reusable way to review TUI render/selection logic without a TTY: feed live `pipeline_list` JSON through the pure functions, inspect rows + `monitorSelectableNodeIds` + duplicate detection. It located the broken-TUI root cause in minutes.
- **Subagent diff review earned its keep twice:** it flagged that work-idle-time's `pipelineObservationBuckets` refactor had orphaned a keystone `@mutate` (hollow checkpoint) before merge, and it swept the repo to confirm the parser fix had no regression.
- Every hand-finished mutation checkpoint was verified to redden under its mutation and restore green — nothing hollow shipped.

## Daemon restart — done; the fixes are live and validated

The operator restarted the daemon mid-session (~2026-08-10 evening); it reloaded to the commit carrying both the **parser fix (#2806)** and the **plan-draft keystone gate (#2822)**, so both are now live, and the stale second daemon is gone (single current-digest daemon). Live validation: the continuation-round implements (Enter-reveal, collapsed-member) flowed through with **no keystone strand** — a marked change from the first-half implements that stranded repeatedly, confirming the parser fix works in situ.

## Operator action needed

- None outstanding. (Future: when re-driving `keystone-links`, expect the plan-draft keystone gate to now *enforce* canonical keystones — a plan emitting a prose-only keystone will be refused at draft, which is the intended behavior.)

Operator cost: **$116.06** (claude-opus-4-8, paid) — 2h11m API / 11h52m wall; 143.8k input, 503.6k output, 171.2m cache read, 1.9m cache write. Jarvis agents ran on **claude via quota** (codex out all session) — billed separately, **not** in this figure.
