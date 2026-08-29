# Pipeline attribution & hygiene continuation brief

Successor to `tui-pipeline-continuation-brief.md`. This doc is the phase tracker for pipeline attribution/settlement/hygiene work; tick as work lands. Refreshed 2026-08-29 against the running daemon and a full `v2/spec` sweep.

## Status — 2026-08-29

The prior P0 (stage↔run join) and the whole ready-gate chain landed this session. No P0 remains open; the sharpest active blocker is now #3036 (deferred-settlement resume loses PR evidence), which strands the terminal PR on every review-bearing pipeline.

### Landed this session

- **P0 stage↔run join** — #3034. `resolveStageInvocationId` resolves a stage's entry run id to the run's `workflow.invocationId` before joining; #2959's branch-aware attribution is now live and the double-print is gone.
- **`pipeline-stage-stuck-running-after-failed-run` (#2960)** — #3046. `unsettledTerminalStageEntryRunId` + `hasRedrivableDeferredSettlement` widening + `dispatchPipelineStage` catch-path marker. A stage whose entry run rolls up `failed` without a `settlement_deferred` marker now settles `failed` and is resume-recoverable. Hand-finished (see #3036 below); seed reaped, spec archived.
- **Ready-gate chain complete** — foundation `ready-gate-failure-detail-names-the-gate-output` (already on main) → `missing-ready-gate-command-settles-without-repair` #3047 (missing command settles named, no repair scaffolding) → `markdown-only-stages-skip-the-ready-gate` #3049 (intent/plan `.md`-only stages skip the gate, provenance fence preserved). All archived.
- **`codex-sandbox-mode-configurable` (#3028)** — #3037. Shared Codex binding honors a resolved `--sandbox` mode threaded from machine config; unblocks codex implement lanes in ambient-trust projects. Archived by hand this session (cleanup gap, below).
- **Seeds authored** — `deferred-settlement-resume-preserves-pr-evidence` (#3036) and four chess-dogfood gaps (#3035: `per-project-agent-fallback-order`, `codex-zero-exit-auth-failure-advances-agent-order`, `blocker-contract-credits-existing-section`, `restart-reconciliation-preserves-paused-resumable-runs`).
- **Runbook** — three dogfood gotchas (#3038).

### Defects surfaced/confirmed this session

- **#3036 `deferred-settlement-resume-preserves-pr-evidence` — RECURRED TWICE** (the P0-join pipeline and the #2960 pipeline). When a pipeline stage settles via the deferred-settlement resume path (#3012), the settled artifact drops `prNumber`/`prUrl`, so the terminal `ready` action fails "PR evidence required", the pipeline reads `failed`, and the good, green work must be hand-finished. This is the single sharpest pipeline-dogfood blocker — **new P0-class**.
- **`iteration_commit_failed` strands a clean implement iteration** — the missing-command implement authored correct work but its boundary commit failed (`unsupported_resume_context`, `nextAction: stop`), stranding the change uncommitted; hand-salvaged. One occurrence, but it blocked a run. **Seed to author.**
- **Cleanup archive-detection gap** — `jarvis cleanup` left `codex-sandbox-mode-configurable` un-archived because its spec (#3033) and implementation (#3037) merged as separate PRs cleanup could not link (squash ancestry is untraceable). Folds into `cleanup-improvements`.
- **Superseded pipeline stage PRs left open** — a wedged pipeline's per-stage draft PRs (#3042/#3043/#3045) stayed open after hand-finish and had to be closed by hand. Covered by ready-intent `settle-superseded-pipeline-prs`; now with a live example.
- **Hand-finish process note (→ runbook)** — when a pipeline's terminal action fails, reuse the pipeline's existing implement-stage draft PR; do not open a duplicate (this session opened #3046 duplicating the pipeline's #3045).

## Priority-ordered work

| P | Item | Delivers | Status / gate |
| --- | --- | --- | --- |
| **P0** | `deferred-settlement-resume-preserves-pr-evidence` (#3036) | Deferred-settlement resume carries `prNumber`/`prUrl` so the terminal action lands; review-bearing pipelines stop stranding their PR | Seeded; recurred 2×; next to plan+implement |
| **P1** | `operator-killed-pipeline-stage-is-recoverable` (#2996) | Operator-killed/`interrupted` stages recover via resume/restart instead of dead-ending | Seeded; sibling of the just-landed #2960; plan next |
| **P1** | `iteration_commit_failed` recoverable (author seed) | A clean implement iteration whose boundary commit fails is committed/recoverable, not stranded uncommitted | Author from this session's salvage |
| **P1** | `pipeline-fan-out-per-lane-terminal-settlement` → `pipeline-fan-out-lanes-serial-chained-bases` | Fan-outs settle/publish per lane; lanes chain serially | Gated: operator's `configure-pipeline-supersede-policy` ready-intent lands first |
| **P1** | `plan-review-failure-preserves-and-recovers-the-good-draft` (#2995) | A plan whose write drafted cleanly but whose review failed keeps a non-destructive land path | Seeded; unstarted; same stage-settlement family |
| **P1** | `harness-publication-push-uses-explicit-refspec` (#2907) | Publication pushes `HEAD:<branch>` so a differently-named upstream never strands at `completion_commit_failed` | Seeded; unstarted |
| **P2** | `settle-superseded-pipeline-prs` + `retire-superseded-pipeline-branches` | Superseded pipeline PRs/branches settled/retired instead of dangling | Ready-intents; operator-gated dogfood family; live example this session |
| **P2** | `cleanup-improvements` + `ready-gate-repair-out-of-diff-edits` | Cleanup reclaims terminal-run worktrees, archives complete specs (including split spec/impl PRs), commits its moves; repair debris reverted | Seeded #3019; codex-sandbox archive gap adds a case |
| **P2** | `implement-retirement-destroys-artifacts-before-materialization` + `implement-resumes-stalled-unmerged-subspec-chain` (#2882) | Retirement validates rematerialization before destroying the worktree; stalled committed-but-unmerged subspec chain resumes non-destructively | Seeded; plan together |
| **P2** | `pipeline-list-display-retention` | Cap terminal pipelines like runs | Seeded |
| **P2** | `tui-dock-command-grammar-mirrors-cli` + `tui-typed-run-steering-clears-command-input` | TUI dock grammar + two dock-submit bugs | Seeded; the join fix cleared the way |

## Full v2/spec inventory (2026-08-29)

**Active specs:** none — all timestamped spec dirs are archived to `completed/`.

**Seeds (`v2/spec/seeds/`):**
- P0: `deferred-settlement-resume-preserves-pr-evidence`.
- P1: `operator-killed-pipeline-stage-is-recoverable`, `pipeline-fan-out-per-lane-terminal-settlement`, `pipeline-fan-out-lanes-serial-chained-bases` (gated), `plan-review-failure-preserves-and-recovers-the-good-draft`, `harness-publication-push-uses-explicit-refspec`.
- P2: `implement-retirement-destroys-artifacts-before-materialization`, `implement-resumes-stalled-unmerged-subspec-chain`, `cleanup-improvements`, `ready-gate-repair-out-of-diff-edits`, `pipeline-list-display-retention`, `tui-dock-command-grammar-mirrors-cli`, `tui-typed-run-steering-clears-command-input`.
- Chess-dogfood (#3035), unscoped priority — decide before planning: `per-project-agent-fallback-order`, `codex-zero-exit-auth-failure-advances-agent-order`, `blocker-contract-credits-existing-section`, `restart-reconciliation-preserves-paused-resumable-runs`.

**Ready-intents (`v2/spec/ready-intents/`):**
- Operator-gated dogfood family: `configure-pipeline-supersede-policy` (gates the fan-out pair), `retire-superseded-pipeline-branches`, `settle-superseded-pipeline-prs`, `rename-pipeline-lane-{persistence,rpc,execution,operator-surfaces}`.
- Queued: `daemon-start-sweeps-orphan-gate-children`.
- Concurrent-load trio (verify moot post split-suite before planning): `concurrent-load-suite-margin-check`, `daemon-test-concurrent-load-isolation`, `workflow-runner-test-concurrent-load-isolation`.
- Stale — verify then reap: `landing-failed-names-its-cause` (its spec is believed landed/archived; confirm feature-on-main, then reap). `ready-gate-failure-detail-names-the-gate-output` was reaped this session (behavior confirmed on main).

## Recommended ordering

1. **#3036 (P0)** — plan+implement; unblocks pipeline dogfooding (good `full-review` candidate, though its own terminal action will hit #3036 until it lands — expect one recursive hand-finish).
2. **#2996** — completes stage-settlement recovery (kill/interrupt sibling of the just-landed #2960); plan with any residual settlement gaps.
3. **`iteration_commit_failed` seed** — author from this session's salvage, then land.
4. **Operator lands `configure-pipeline-supersede-policy`** → fan-out per-lane-settlement + serial-chain pair.
5. **`plan-review-failure` (#2995), `publication-push-refspec` (#2907)** — publication/recovery robustness on every review-bearing stage.
6. **Hygiene tail** — superseded PR/branch settlement, `cleanup-improvements` (incl. the split spec/impl archive gap), retention, TUI dock polish.

Test strategy unchanged: pure functions + injected input hook for TUI; daemon/state tests for pipeline items. Fixtures for the pipeline tree must mirror the production id relationship (stage records the entry run id ≠ the runs' invocation id) — assumption drift between fixtures and the daemon is how the join P0 shipped green.
