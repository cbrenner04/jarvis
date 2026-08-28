# Pipeline attribution & hygiene continuation brief

Successor to `tui-pipeline-continuation-brief.md` (that phase shipped the recovery cluster, both dismiss chains, explicit-expansion navigation, the attention segment, the deferred-settlement chain, and the implement-publication fix). Sourced from the 2026-08-28 cleanup/hand-finish session plus live dogfood data pulled from the running daemon. This doc is the phase tracker: tick as work lands.

## What closed since the last brief (2026-08-25 → 2026-08-28)

- **Settlement chain complete**: `tui-attention-segment-suppresses-stale-terminal-incidents` (#3007 — the last open TUI P1), `daemon-start-reconciles-deferred-pipeline-settlement` (#3010), `pipeline-resume-drives-deferred-settlement` (#3012).
- **Implement publication fixed (#2958 closed)** — the #1 friction of the prior two sessions. Subspec 00 #3015; subspec 01 (identity fallback from branch `Jarvis-Agent` attribution) #3018. Recursive validation: the branch *implementing* the fix was itself stranded gate-passed-but-PR-less by the pre-fix code and hand-landed as #3018. If a gate-passed pushed branch ever ends PR-less again post-#3018, that is a new skip path — seed it then, not before.
- **Infra**: `workflow-runner.test.ts` monolith split (#2998/#2999, issue #2181 closed); serial `test:cost` baseline refreshed and the split-suite spec finished (#3019); `contention-safe-heavy-test-scheduling` subspec 01 (margin-derived budget) **descoped** with an in-spec note.
- **Hygiene session (2026-08-28)**: 28 stale worktrees torn down, 11 landed specs archived (#3017), runbook gained "Hand-publish leaves spec bookkeeping behind" (verify-then-tick, archive in the same sitting), seeds `cleanup-improvements` (4 cleanup defects) and `ready-gate-repair-out-of-diff-edits` landed (#3019).
- **Landed**: `20260824T014411Z-intent-landing-never-treats-node-modules-symlink-as-rogue` subspecs 01+02 (#3022 — review-debate verdict's 4 required outcomes all shipped; spec complete, all three index boxes ticked, archive at next cleanup). **In flight**: chess dogfood fan-out pipeline `af881ac0` (fast, 6 lanes).

## ⚠️ P0 — the pipeline stage↔run join is broken; the double-print is back with a *different* root cause

Operator re-observed pipelines' workflows double-printing in the TUI (2026-08-28), after #2959 supposedly fixed it. Root-caused against the live daemon:

- Since **#2566** (2026-08-03, "Stage linkage follows the admitted entry run"), `writeRunningStageLinkage` (`v2/src/daemon/pipeline-stage-dispatch.ts`) stores the **entry run id** in `stage.workflowInvocationId`; the file's own helpers read it back as `entryRunId`. The field name no longer matches its contents.
- Run rows carry a **distinct workflow invocation UUID**. Live proof from pipeline `af881ac0`: the intent stage records `workflowInvocationId b3e6d0fc-…` (= its artifact's `entryRunId`), while run `b3e6d0fc-…` carries `workflow.invocationId ea3f38c9-…` (= the artifact's `invocationId`). Same shape on every stage.
- The TUI join (`v2/src/tui/tui-monitor-pipeline-tree.ts:480,633`) matches `run.workflow.invocationId === stage.workflowInvocationId` with no run-id fallback → **no run ever joins any pipeline stage**. Every pipeline workflow paints as a top-level ad-hoc row alongside the pipeline subtree — the double-print.
- Compounding: #2959's branch-aware claims are built *from the runs joined to the stage's recorded invocation id* — zero joined runs → empty claim sets → **the entire branch-aware attribution fix is inert in production** despite its 12 green tests. The fixtures encode the pre-#2566 assumption that the stage field holds an invocation id ("green gate is not evidence code runs", again).

**Seed next** (highest-leverage item in this brief): either the TUI join resolves the stage's entry run id to its run row and attributes by that run's `workflow.invocationId` (pure projection fix), or dispatch records the real invocation id on the stage (wire/store fix, touches everything reading `entryRunId` from the field — dispatch, recovery, settlement) — the plan decides; the projection fix is smaller and multi-daemon-safe. Pin with a fixture whose stage records the entry *run* id, distinct from the runs' invocation id, matching production. The stale seed `tui-stage-run-duplicated-as-top-level.md` (its spec landed as #2959) should be **deleted and replaced** by this one — same symptom, different defect.

## Pipeline work (priority-ordered)

| P | Item | Delivers | Status / gate |
| --- | --- | --- | --- |
| **P0** | `pipeline-stage-run-join-resolves-entry-run-id` | Pipelines actually contain their runs; #2959 becomes live; double-print ends | Seeded #3021; unstarted — next to plan+implement |
| **P1** | `pipeline-fan-out-per-lane-terminal-settlement` → `pipeline-fan-out-lanes-serial-chained-bases` | Fan-outs settle/publish per lane; lanes chain serially | Unchanged gate: operator's `configure-pipeline-supersede-policy` ready-intent lands first. Live urgency: `af881ac0` is a real 6-lane fan-out running now |
| **P1** | `pipeline-stage-stuck-running-after-failed-run` (#2960) + `operator-killed-pipeline-stage-is-recoverable` (#2996) | Quota-failed and operator-killed stages settle/recover instead of wedging `running`/`interrupted` | Seeded; plan together (both are stage-settlement gaps) |
| **P1** | `plan-review-failure-preserves-and-recovers-the-good-draft` (#2995) | A plan whose write step drafted cleanly but whose review step failed no longer strands the good draft — recover/resume gain a non-destructive land path | Seeded 2026-08-24 **dogfooding `full-review`** (pipeline `0f0b45d9`); unstarted. Same stage-settlement family as #2960/#2996; the review step is the fragile part on every review-bearing pipeline |
| **P1** | `harness-publication-push-uses-explicit-refspec` (#2907) | Publication pushes `git push origin HEAD:<branch>` so a differently-named upstream (worktree from `--base origin/main`) never strands the PR at `completion_commit_failed` | Seeded 2026-08-18; unstarted. Every pipeline stage and manual implement publishes through this push; workaround is operator-set `push.default=current`, which the harness must not depend on |
| **P2** | `cleanup-improvements` + `ready-gate-repair-out-of-diff-edits` | Cleanup reclaims terminal-run worktrees, commits its moves, stops inspecting junk dirs; repair debris reverted | Seeded 2026-08-28 (#3019) |
| **P2** | `implement-retirement-destroys-artifacts-before-materialization` + `implement-resumes-stalled-unmerged-subspec-chain` (#2882) | Stale-workspace retirement validates rematerialization **before** destroying the worktree/branch (kills the self-referential `--base <same-branch>` trap); a stalled committed-but-unmerged subspec chain gets a non-destructive resume instead of merge-or-discard | Seeded 2026-08-16; unstarted; plan together (both are implement-chain recovery/safety). Sharp case: `--base` naming the branch being retired deletes it, then `git branch X X` fails and the work survives only as dangling objects |
| **P2** | `pipeline-list-display-retention` | Cap terminal pipelines like runs | Last survivor of the display-hygiene trio |

Folded in 2026-08-28: the four rows citing #2995/#2907/#2882 are pre-brief seeds (2026-08-16 → 08-24) that never entered the prior phase tracker. All four are recovery/publication-robustness gaps that surface directly under pipeline dogfooding — `plan-review-failure` and the fan-out work are the sharpest pipeline blockers; the implement-recovery and push-refspec pair harden every stage that publishes or re-runs.

## TUI work

The P0 join fix supersedes all TUI work — nothing else in the pipeline tree means much while the join is broken. After it: `tui-dock-command-grammar-mirrors-cli` (P2, standalone redesign) and `tui-typed-run-steering-clears-command-input` (P2, two small dock-submit bugs).

## Ready-intents shelf state

- **Stale — reap**: `landing-failed-names-its-cause.md` and `ready-gate-failure-detail-names-the-gate-output.md` (both specs landed and archived, 2026-08-24/25).
- **Overlap — decide before planning**: `concurrent-load-suite-margin-check.md`'s prerequisite ("budget documented with a stated margin over the slowest audited file") is exactly the contention-safe subspec 01 **descoped 2026-08-28**; either retire this ready-intent with the same rationale or treat the refreshed 2026-08-28 `test:cost` baseline as its measurement input. Related pair `daemon-test-concurrent-load-isolation.md` / `workflow-runner-test-concurrent-load-isolation.md` may be moot post-split — verify against the 2026-08-18/08-25 `LOAD_SENSITIVE_FILES` state before planning.
- **Operator-gated dogfood family**: `configure-pipeline-supersede-policy` (gates fan-out), `retire-superseded-pipeline-branches`, `settle-superseded-pipeline-prs`, `rename-pipeline-lane-{persistence,rpc,execution,operator-surfaces}`.
- **Queued**: `daemon-start-sweeps-orphan-gate-children`, `markdown-only-stages-skip-the-ready-gate`, `missing-ready-gate-command-settles-without-repair`.

## Recommended ordering

1. **Plan + implement the stage↔run join seed (P0, seeded #3021)** — every pipeline/TUI surface reads through this join; #2959's shipped work is dark until it's fixed. Good `full-review` pipeline dogfood candidate.
2. **Operator lands `configure-pipeline-supersede-policy`**, unblocking the fan-out correctness pair (the chess dogfood makes this concrete: today's 6-lane run will read `failed` at terminal settlement regardless of lane outcomes).
3. **Stage-settlement seeds** (#2960 + #2996) — recovery completeness for the two remaining wedge paths.
4. **Cleanup + repair-debris seeds** — makes the next hygiene sweep a no-op instead of a session.
5. **Retention, dock grammar, steering** — polish tail.

Test strategy unchanged: pure functions + injected input hook for TUI (`v2/docs/test-writing.md`); daemon/state tests for pipeline items. New rule from this phase: fixtures for the pipeline tree must mirror the **production id relationship** (stage records entry run id ≠ runs' invocation id) — assumption drift between fixtures and the daemon is how the P0 shipped green.
