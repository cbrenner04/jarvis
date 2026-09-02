# 2026-09-02 — gate-fix trio, #3122 closed, parallelization ceiling measured

Operator-present session, ~18h wall with one ~10.5h idle gap (see Process failures). Successor to [`20260902T032711Z-dogfood-throughput-gate-fixes-refactor-start.md`](./20260902T032711Z-dogfood-throughput-gate-fixes-refactor-start.md).

## Headline

**#3122 is closed.** A `plan.commit: false` project now rides v2 implement end to end — standalone, through a pipeline, and with `jarvis cleanup` archiving completed external trees. This unblocks the operator's homestead work, which had been stuck at plan with no implement path.

**The three gates that taxed every run are fixed and live.** Ready-gate autofix no longer runs repo-wide; the plan contract no longer rejects single-file acceptance criteria; the prompts no longer tell the implement loop to run the full aggregate suite every iteration.

## Landed (23 PRs merged)

### The #3122 external-spec chain — COMPLETE

| Lane | PR | Note |
| --- | --- | --- |
| chain-external-plan-specs-into-implement | [#3350](https://github.com/cbrenner04/jarvis/pull/3350) | Chained implement resolves the external plan home through the same `resolveExternalPlanSpecIdentity` standalone uses; no `preflightGitRoot` against the non-Git plan workspace |
| archive lane, subspec 00 | [#3360](https://github.com/cbrenner04/jarvis/pull/3360) | `sourceForRun` / `recordedStrandedBranch` resolve absolute external identities |
| archive lane, subspecs 01–03 | [#3363](https://github.com/cbrenner04/jarvis/pull/3363) | Discovery + archival to `plans/completed/`; **closes #3122** |
| plan specs | [#3345](https://github.com/cbrenner04/jarvis/pull/3345), [#3354](https://github.com/cbrenner04/jarvis/pull/3354) | chain hand-landed past #3114 |

CI caught a real regression in #3350 before merge: the branch called `resolveExternalPlanSpecIdentity` on *every* chained stage, failing `pipeline_resume dispatches chained plan and implement stages after prior worktree removal` with a fail **and an error**. Local isolated runs did not reproduce it. Gated to `<jarvisHome>/specs/` and re-verified on the runner (17 pass / 0 fail).

### Gate fixes

- **Scoped ready-gate autofix** — [#3343](https://github.com/cbrenner04/jarvis/pull/3343). Built-in autofix ran repo-wide `bun run fix`, so pre-existing out-of-diff findings blew biome's diagnostic cap and settled `completion_commit_failed` on complete work. Now scoped to `<baseRef>...HEAD` ∪ untracked with `--max-diagnostics=256`, failing closed on enumeration error. **Validated in production the same session**: the archive lane later failed the same boundary, but scoped to its own 4 changed files, with findings genuinely in its own new code.
- **Plan-contract single-artifact exemption** — [#3348](https://github.com/cbrenner04/jarvis/pull/3348). The #3114 class. `classifyModuleBoundaryText` regex-matched surface keywords across a bullet's whole text, so `v2/docs/workflow-runner.md` contributed `execution-loop` **as a filename** while "daemon" in the prose contributed a second surface. Six sound drafts were blocked before the fix, each hand-landed unchanged. **Known limit:** the exemption keys on path-style references; a bullet naming two bare filenames (`` `cli.ts` ``, `` `daemon.ts` ``) still trips it — hand-landed as [#3357](https://github.com/cbrenner04/jarvis/pull/3357), follow-up not yet seeded.
- **Scoped test guidance in the prompt corpus** — [#3344](https://github.com/cbrenner04/jarvis/pull/3344). `prompts/patch/rules.md` told the implement loop to run the aggregate `bun run test` every iteration, contradicting `AGENTS.md`; `prompts/plan/draft.md` said nothing about which command a gate AC should name. Both now direct the scoped script. Also added the **missing** `prompts/patch/rules.md` render-observer map entry (a #3199-class bootstrap trap) and bumped three prompt revisions with regenerated fixtures.

### Refactor chains

- **split-workflow-runner:** `extract-review-debate-landing-module` [#3351] — the prior session's handoff. `workflow-runner.ts` shrank ~1,005 lines into a 1,040-line sibling. Assertion inventory checked against main: 35/152 → 36/161, nothing dropped. `extract-workflow-runner-resume-machines` planned [#3358].
- **split-daemon:** `typed-step-stubs-and-bounded-spins` [#3352] (zero `as unknown as AnyWorkflowStep` casts remain; assertions 198/1608 → 203/1621); `modularize-daemon` subspecs 00–01 [#3364]; plans [#3337], [#3357].
- **CLI trim:** `retire-tui-daemon-client-start` [#3349], `retire-legacy-workflow-aliases` [#3356], plans [#3335] [#3336] [#3347].
- **Persistence:** `squash-state-store-migrations` [#3362] — baselined schema; existing stores upgrade once via `031-baseline-squash`, transactional with rollback, idempotent via marker.
- **Prompt corpus:** `terse-plan-review-role-prompts` [#3342] — role bodies down 50–66%, with a growth-budget suite whose baselines equal the pre-fix registry lengths and a contract-preservation suite pinning the semantics that must survive.
- **Housekeeping:** [#3333] archived 10 completed specs left uncommitted by a prior cleanup pass and reaped 8 stale ready-intents; [#3341] [#3355] [#3359] [#3361] seeds and ledger.

## Parallelization ceiling — measured

The operator asked for experimentation. Result:

- intents/plans fan out ~free.
- **2 concurrent implements clean; 3 saturates; 5–6 destroys work.** At load ~30 with 5–6 lanes, three runs died to `invocation_error` in one batch (`modularize-daemon` at 2/8 subspecs with 12 commits, `archive-external` at 7/8 on subspec 00, `terse-implement` at 0). `invocation_error` is **non-resumable**, so each loss is a full re-dispatch that discards the branch. The failure mode is the agent binding under contention, not a watchdog false-kill.
- **Corollary, learned the hard way:** never run a local `bun test` suite beside live implements. Four separate "failures" this session (`init.test.ts` + `pipeline-start-admission.test.ts`; `cli.test.ts` + `workflow.test.ts`; two daemon suites at ~5010 ms; three pipeline suites) were pure contention — every file passed in isolation.

## The land-a-slice pattern

A multi-subspec spec that cannot finish in one iteration budget **cannot converge by re-dispatch**: a re-run either resets the workspace (discarding completed subspecs) or is refused by the preserve-landed-criteria gate. Landing the completed subspecs to `main` clears the gate so the next dispatch routes to the first unfinished one. Used for the archive lane (#3360 → #3363), `modularize-daemon` (#3364), and `pipeline-resume-recover-stale-reset-override-flags` (#3365). This is the technique that actually closed #3122.

## Strand taxonomy

**Every implement produced correct work.** All nine hand-finishes were settlement-tail failures, not bad code:

| Cause | Count | Status |
| --- | --- | --- |
| `ready_gate_command_missing` misclassification | 2 | Seeded [#3355] |
| `iteration_timeout` from aggregate-suite ACs | 3 | Prompt fixed [#3344] |
| Out-of-diff repo-wide autofix | 1 | Fixed [#3343] |
| Publication left a complete PR in draft | 1 | — |
| Blocker appended over the run's own unticked criteria | 1 | — |
| Wedged at the tail, no process | 1 | — |

## Two defects caught only by reading the work

1. **A stranded mutation mutant in production source.** `squash-state-store-migrations` completed all four subspecs, wedged, and left `run.status !== "failed"` applied to `workflow-run-status-rollup.ts` — an inverted guard where committed history has `=== "failed"`. It broke the hidden-shrink rollup so a *failed* shrink would roll the entry row up to `completed`, and failed 4 tests in isolation while `main` was green. Committing the dirty tree unexamined would have shipped it (the #2314 class). The mutant sat in a file the spec only touched for one import line.
2. **A structure pin asserting against an empty string.** `daemon-workflow-start.test.ts` slices `daemon.ts` between section markers to assert workflow start, pipeline dispatch, and recovery all route through `admitWorkflowStart`. The extraction moved two markers into the new module, `indexOf` missed, and the slice came back `""`. Re-homed to resolve each section from whichever module declares it, throwing if none does.

Both belong to one pattern that showed up **four** times this session (with #3330's line-keyed inventory and #3348's whole-text keyword match): **invariants keyed to incidental structure rather than to the thing they assert.** Worth treating as a class.

## Process failures (mine)

- **~10.5h idle gap.** My waiters were `tail -f … | head -1`, which self-terminate after one line and must be re-armed; I ended several turns with neither a live waiter nor a `ScheduleWakeup`. Nothing woke the session. Two lanes burned `iteration_timeout` unattended and one wedged. Fixed for this session by moving to `/loop`; seeded durably as `notifications-wait-is-the-operator-wake-primitive` [#3361].
- **Nearly acted on a destructive misdiagnosis.** Three implements read `in-progress`/`not-live` and I concluded they were orphaned. The operator challenged it; they were **live** under superseded same-key daemons, with a 40-minute-old `cursor-agent` actively editing one worktree. The documented recovery for that tell is `kill -9`, which would have destroyed live work across every registered project including the operator's chess runs. Runbook fenced with liveness checks and seeded [#3341].
- **Over-parallelized**, costing three runs (above).

## New seeds

| Seed | PR |
| --- | --- |
| `run-list-cannot-reach-superseded-daemon-runs` | [#3341] |
| `ready-gate-command-missing-misclassifies-lint-failures` | [#3355] |
| `boundary-split-emits-near-duplicate-subspecs` | [#3359] |
| `notifications-wait-is-the-operator-wake-primitive` | [#3361] |

## Agent attribution and cost

352 role invocations: **codex quota'd on all 176 of its attempts; cursor did all 166 successful ones** (10 errors). Same attribution correction as 2026-08-30 — the configured `codex, cursor, claude` order is de facto cursor-first.

Agent-side cost **$31.37**, all cursor list-price. Operator cost is separate (see CSVs).

## Open at close

- `terse-implement-review-role-prompts` — failed twice (`invocation_error`, then `iteration_timeout`), 0/14 criteria. Spec on `main`, re-runnable.
- `modularize-daemon` subspecs 02–07 and `pipeline-resume-recover-stale-reset-override-flags` subspecs 02–03 — both bases landed, next dispatch routes straight to the first unfinished subspec.
- `#3114` bare-filename shape (above), unseeded.
