# Operator session — pipeline-attribution brief continuation, ready-gate chain, and the CLI↔daemon config-parity gap

UTC close: 2026-08-29T06:00Z. Agent order: **codex → cursor → claude** (kept all session per operator). Continuation of `v2/spec/pipeline-attribution-and-hygiene-brief.md`, plus chess-mvp-yolo dogfood findings folded in.

## Headline

Landed the brief's **P0 stage↔run join** and the full **ready-gate chain**, closed the **#2960** stage-settlement wedge, shipped **codex sandbox mode** config, landed **#3036 subspec 00** (PR-evidence-before-completed) and **config-parity subspec 00** (shared step-config stamp). The dominant new finding: the **entire step-config layer is dropped on the daemon pipeline-dispatch path** (readyCommand/fixCommand/iteration-bounds/review-timeouts), which is why chess pipelines ran `bun run ready` instead of the configured `make test` and why pipeline write steps never armed the ceiling/idle-output watchdogs. **~10 implementation PRs merged; 1 open for operator review (#3060, blocked).**

Recurring dogfood friction, now well-characterized: the **pipeline fan-out cannot serial-chain dependent lanes**, so every multi-subspec fix (#3036, config-parity) fanned into dependent lanes and had to be consolidated + driven standalone; and **`idle_output_timeout` is a real watchdog blind spot** (caught live: a cursor agent validly running a silent test suite was killed, leaving orphaned procs).

## Landed (merged)

- **P0 — stage↔run join** [#3034](https://github.com/cbrenner04/jarvis/pull/3034): `resolveStageInvocationId` resolves a stage's entry-run id to the run's `workflow.invocationId` before joining; makes #2959's branch-aware attribution live and ends the double-print. (Hand-finished after a deferred-settlement wedge + the #3036 PR-evidence loss.)
- **#2960 stuck-running settlement** [#3046](https://github.com/cbrenner04/jarvis/pull/3046): `unsettledTerminalStageEntryRunId` + widened `hasRedrivableDeferredSettlement` + dispatch catch-path marker — a stage whose entry run rolls up `failed` without a `settlement_deferred` marker now settles `failed` and is resume-recoverable.
- **Ready-gate chain**: foundation already on main → **missing-command** [#3047](https://github.com/cbrenner04/jarvis/pull/3047) (settles named, no 14-min scaffolding repair) → **markdown-only stages skip the gate** [#3049](https://github.com/cbrenner04/jarvis/pull/3049) (intent/plan `.md`-only stages, provenance fence preserved; resume-path landing caught by the debate reviewer).
- **codex sandbox mode configurable** [#3037](https://github.com/cbrenner04/jarvis/pull/3037) (spec #3033) — shared codex `--sandbox` mode from machine config; archived by hand (cleanup couldn't link the split spec/impl PRs — a `cleanup-improvements` case).
- **#3036 subspec 00** [#3054](https://github.com/cbrenner04/jarvis/pull/3054): completion publication persists `prNumber`/`prUrl` **before** the run becomes durably `completed`, on all fresh and resume tails.
- **config-parity subspec 00** [#3059](https://github.com/cbrenner04/jarvis/pull/3059): extract `stampWorkflowStepsWithMachineConfig` shared export; CLI delegates (behavior-preserving base for the daemon fix).
- **#3022** node_modules-symlink intent (over the line); brief updates [#3023](https://github.com/cbrenner04/jarvis/pull/3023)/[#3050](https://github.com/cbrenner04/jarvis/pull/3050); runbook gotchas [#3038](https://github.com/cbrenner04/jarvis/pull/3038).

## Specs/plans merged (implement to follow)

- `deferred-settlement-resume-preserves-pr-evidence` (#3036) spec [#3051](https://github.com/cbrenner04/jarvis/pull/3051) — subspec 00 landed (#3054); **subspec 01 (daemon settlement) not started**.
- `pipeline-dispatch-config-parity` (#3055) spec [#3057](https://github.com/cbrenner04/jarvis/pull/3057) — subspec 00 landed (#3059); **01 blocked (#3060); 02 not started**.

## Open for review — do not merge

- **[#3060](https://github.com/cbrenner04/jarvis/pull/3060)** — config-parity subspec 01 (daemon dispatch stamping). Production correct; stamping unit tests pass (47, `@mutate` verified). **BLOCKED**: `pipeline-execution.test.ts` hangs (109/109 in 1.84s on `main`; times out here + on CI). Root-caused by bisecting `stampPipelineDispatchSteps` — a passthrough passes in 1.86s, so the **stamped watchdog/timeout fields** are the trigger: the daemon now stamps long durations (~30-min ceiling, 90-s idle, 30-min review role) onto steps a test drives through a path arming **real timers not `.unref()`-d**, keeping bun's loop alive so the file never exits. Fix direction: `.unref()` the watchdog timers. Documented as a `## Blocker` in the subspec.

## Seeds authored

`deferred-settlement-resume-preserves-pr-evidence` (#3036) [#3036]; 4 chess-dogfood gaps [#3035]; `implement-boundary-commit-failure-strands-authored-work` [#3052]; `pipeline-dispatch-threads-project-ready-and-fix-commands` [#3053] then broadened to the full config layer [#3055]; `full-light-review` pipeline [#3058].

## Findings / friction (for follow-up)

1. **CLI↔daemon step-config divergence (the big one).** `prepareWorkflowSteps` (CLI only) stamps readyCommand/fixCommand/iteration-bounds/review-timeouts; the daemon pipeline dispatch (`startWorkflowRun` adds only `signal`) drops **all five**. Result: pipeline implements ignore configured `readyCommand` (chess `make test` → defaulted `bun run ready` → `ready_gate_command_missing`), and pipeline **write steps never arm the ceiling/idle-output watchdogs** — diverging even at default config. Fix in flight (#3055/#3057/#3059/#3060), blocked on the timer hang above.
2. **Fan-out can't serial-chain dependent lanes.** Both #3036 and config-parity fanned into dependent lanes (lane N needs lane N−1's code on the same base); the fan-out puts lanes on independent bases → broken. Every multi-subspec fix this session was consolidated + driven standalone. This is the sharpest structural blocker to pipeline-dogfooding real fixes (`pipeline-fan-out-lanes-serial-chained-bases`, gated on the operator's `configure-pipeline-supersede-policy`).
3. **`idle_output_timeout` is a real watchdog blind spot** — caught live: a cursor agent validly running a silent `bun test` was killed as idle, and the kill orphaned the hung test (reparented to init, still burning CPU); `run kill --force` refuses a terminal run so nothing reaps it.
4. **`iteration_commit_failed` strands clean work** (2×: missing-command, #3036 subspec 00) — resumable:true but the daemon projects `unsupported_resume_context`/stop; hand-salvaged (seeded #3052). Not universal (markdown-only self-published fine).
5. **#3036 PR-evidence loss recurred 2×** (P0-join + #2960 pipelines) — deferred-settlement resume drops `prNumber`/`prUrl` → terminal `ready` fails; the reason #3036 is now the brief P0. Spec 00 landed; 01 pending.
6. **Standalone reviewed-plan blocks on multi-surface AC bullets** — the plan-contract gate rejected #3036 and config-parity plans on compound AC bullets; salvaged from the `.jarvis-plan-stage` draft by hand each time.

## Process notes

- Hand-finish: when a pipeline's terminal action fails, **reuse the pipeline's existing implement-stage PR** — this session opened #3046 duplicating the pipeline's #3045 (closed #3042/#3043/#3045 after).
- Work in a worktree, not the primary checkout (corrected mid-session).

## Cost

Operator opus-4-8: **$142.07** paid (API 3h11m07s / wall 11h04m52s; 108.0k in / 799.3k out, 206.6M cache read, 2.1M cache write; 1050 lines added / 180 removed). Jarvis agents ran via codex/cursor/claude quota — not in the operator figure.
