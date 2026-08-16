# Session report — guard-reprompt trio + live TUI/pipeline dogfooding (2026-08-16)

## Assignment

"Read `v2/spec/tui-command-center-brief.md`. I believe the single seed, the single ready-intent, and the single plan are all that is left. I want to complete this." Codex-first agent order; claude second.

The three open items were: seed `implement-reprompts-unlinked-guard-checkpoints`, ready-intent `daemon-start-sweeps-orphan-gate-children`, and plan `20260811T063011Z-ready-gate-reaps-test-children` (reap chain, implement parked).

## Outcome (honest status)

- **Guard-reprompt work — SHIPPED in full.** The one seed fanned (correctly) into three behavior-split intents; all three implemented and merged: reprompt (#2853), persist (#2858), resume (#2864).
- **Reap chain — NOT started.** Still parked (`20260811T063011Z-ready-gate-reaps-test-children`); subspec 01 still needs a re-plan for the byte-identical `@mutate` anchor problem.
- **`daemon-start-sweeps-orphan-gate-children` — NOT started.** Ready-intent still open.

So of the assigned three, one shipped. The session deliberately pivoted: mid-way the operator began **live-dogfooding real fan-out pipelines through the TUI**, and that surfaced a large, high-value class of harness gaps — culminating in the discovery that **pipelines are not viable without blocker-recovery.** Capturing and prioritizing that (13 seeds + a phase brief) became the session's dominant, higher-value work, with the operator's explicit direction. The reap/daemon-sweep items were consciously deferred.

## Implementation PRs (code)

The guard-reprompt trio — extends #2827's keystone reprompt to **guard** mutation checkpoints (unlinked + hollow), with durable event + daemon-resume replay:

- **#2853** — Reprompt unlinked and hollow guard checkpoints (execution loop). Clean workflow run; publication emitted nothing, hand-finished (branch/PR); adversarial subagent diff-review: real-and-correct.
- **#2858** — Persist `guard_checkpoint_reprompt` event (persistence). Implement blocked on a flaky-timeout `## Blocker`; verified independently (typecheck + persist tests 240/0 + diff-review real-and-correct), hand-finished.
- **#2864** — Daemon resume replays guard context (daemon). Full workflow incl. publication succeeded; diff-review real-and-correct (99/0); merged.

## Spec / plan PRs

- #2839 intent (guard seed) — split, then consolidated by hand; **reverted** (#2846) back to the correct three behavior intents after operator feedback that behavior-split is right (six subspecs is fine; never one massive subspec).
- #2842 — 6-subspec consolidated plan, **closed** (superseded by the revert).
- #2848 reprompt plan; #2855 persist plan (hand-finished past a 3× multi-surface-AC block); #2860 resume plan (hand-finished, same block).
- #2862 — remove leaked `.jarvis-plan-stage/` from main + gitignore it (a botched publication committed the staging dir).
- #2863 — republish the recovered `distinguish-jarvis-commit-steps` plan draft to a proper spec (the draft #2862 removed).

## Seeds harvested from dogfooding (13) + brief

TUI (6): `tui-attention-segment-suppresses-stale-terminal-incidents` (incl. gate-crowding), `tui-typed-run-steering-clears-command-input` (dock clear + `start` silent-failure), `tui-down-arrow-reveals-without-persisting-expansion`, `tui-left-right-pane-divider`, `tui-dock-command-grammar-mirrors-cli`, `tui-stage-run-duplicated-as-top-level`. (#2841, #2843, #2847, #2856)

Pipeline/run (5, mine): `pipeline-list-display-retention`, `operator-dismisses-pipelines-from-display`, `operator-terminates-stale-nonactive-runs`, `branch-scoped-pipeline-resume` (#2861), `pipeline-stage-recoverable-after-blocker` (#2865 — the load-bearing recovery seed).

Operator-authored (4, landed on their behalf via the brief PR #2866): `pipeline-fan-out-per-lane-terminal-settlement`, `pipeline-fan-out-lanes-serial-chained-bases`, `plan-draft-blocker-append-creates-bare-spec-file`, `plan-draft-harness-blocker-survives-redraft`.

Brief: **#2866** `v2/spec/tui-pipeline-continuation-brief.md` — catalogs all the above with priority/ordering. **Headline recommendation:** the recovery cluster is P0 and load-bearing; if only one thing ships it is `plan-draft-harness-blocker-survives-redraft` (smallest fix, largest unblocking effect — it is why every plan re-run this session silently re-failed on a stale harness blocker).

## Frictions observed (root causes now mostly seeded)

- **Recurring plan-draft "multi-surface AC bullet" / stale-blocker block** hit the reprompt plan 1×, persist 3×, resume 1× — forcing three hand-finished plan publications. Root-caused by the operator's `plan-draft-harness-blocker-survives-redraft` seed (a harness-appended blocker survives into the redraft and re-fails a passing tree).
- **Flaky real-subprocess tests time out at 30s under machine load** (`completion-commit`, `diff-derived-mutation-verifier`), blocking two implements that were otherwise complete (verified + hand-finished). Load was real: many concurrent dogfood pipelines + agent runs.
- **Publication frequently emits no PR / commits the staging dir** — reprompt/persist hand-finished; the `.jarvis-plan-stage`-to-main leak cleaned + gitignored (#2862/#2863).
- **Pipelines have no recovery, no retention, no dismiss; runs stuck `paused`/`unsupported_resume_context` are unresumable *and* unkillable** — all seeded. Two stale paused runs were flipped terminal via a durable status edit (operator ran the sqlite `UPDATE`; the auto-mode classifier blocked the agent from doing it).
- **`pipeline resume` semantics confused the operator repeatedly** — whole-pipeline only, no-ops on a gated pipeline, refuses a running one; diagnosed live each time.

## Process notes

- **Decomposition correction:** consolidating the behavior-split intent to "match #2827's single subspec" was wrong; reverted per operator. Saved to memory: seed→behavior intents→manageable subspec commits; never one massive subspec.
- **`jarvis cleanup` NOT run blanket** — the operator was actively dogfooding in the same repo, so a blanket cleanup could retire/archive their in-flight worktrees/specs. Scoped hand-teardown of my own scratch worktrees only; `jarvis cleanup` left for the operator to run once dogfooding settles.

## Cost

- Operator (this session): **$109.41 paid** — claude-opus-4-8 (20.4k in / 445.2k out, 180.8m cache read, 836.1k cache write, $109.40) + trivial claude-haiku-4-5 ($0.0014). API 1h 52m 50s / wall 4h 46m 45s. Operator code changes: 752 added, 29 removed.
- Jarvis agents: codex-first order, but every workflow run cascaded to **claude via quota** (not in the paid figure).
- **Cost read:** ~$109 for one shipped code deliverable (the guard trio) plus 13 seeds, a phase brief, and two leak fixes. The high paid cost relative to shipped *code* reflects the session's true shape — it was dominated by live dogfooding diagnosis and seed authorship, not by driving implements. The single highest-value output (the recovery-cluster brief + `plan-draft-harness-blocker-survives-redraft` seed) is worth far more than its token cost.

See CSVs (`reports/*.csv`) for the row.
