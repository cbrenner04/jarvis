# Structural-recovery traceability ledger

Supplemental to `structural-recovery-brief.md`. Tracks each `seeds/*.md` seed through the pipeline: seed → ready-intent(s) → plan → implement. **Point-in-time snapshot as of 2026-08-30.** PR cells link to the GitHub PR that landed that stage; unverifiable cells are `—`. Grouped by the brief's priority tiers. Regenerate by re-tracing seeds/ready-intents against the brief and `git log --grep`.

A seed with multiple ready-intents spans one row per ready-intent; the `Seed` and `Status` cells are filled on the seed's first row only. Each ready-intent's own `Plan`/`Implement` PRs sit on its row. Most on-disk seeds are pre-intent (`not-started`) — a seed file is typically reaped once its `intent` run lands, so an already-split seed's ready-intents appear in the orphan table below rather than beside a seed row.

## Seed ledger

| Seed | Status | Ready-intent | Plan | Implement |
| --- | --- | --- | --- | --- |
| pipeline-dispatch-shares-cli-front-door | in-flight | admit-pipeline-recovery-through-workflow-start | — | — |
| | | dispatch-pipeline-stages-through-shared-preparation | [20260830T062000Z-dispatch-pipeline-stages-through-shared-preparation](https://github.com/cbrenner04/jarvis/pull/3165) (hand-landed) | — |
| | | require-complete-pipeline-context | [20260830T041003Z-require-complete-pipeline-context](https://github.com/cbrenner04/jarvis/pull/3148) | [#3155](https://github.com/cbrenner04/jarvis/pull/3155) |
| | | share-workflow-start-preparation (intent #3076) | [20260830T025737Z-share-workflow-start-preparation](https://github.com/cbrenner04/jarvis/pull/3141) | [#3143](https://github.com/cbrenner04/jarvis/pull/3143) |
| pipeline-settlement-derives-from-run-rows | intent-split | canonical-pipeline-execution-state-and-stage-claims | deferred — plan drafted 2026-08-30 but 00/01 subspecs near-duplicate; needs re-plan | — |
| | | daemon-terminal-run-stage-settlement | blocked on canonical + durable-run-backed landing | — |
| | | durable-run-backed-stage-settlement (intent #3075) | [20260830T062002Z-durable-run-backed-stage-settlement](https://github.com/cbrenner04/jarvis/pull/3165) (hand-landed) | — |
| implement-admits-externally-landed-specs | held (P2; seq. behind front-door) | — | — | — |
| all-spec-documents-external-capable | held (P2; seq. behind front-door) | — | — | — |
| split-workflow-runner-resume-machines | not-started (P2) | — | — | — |
| split-daemon-run-control-handlers | not-started (P2) | — | — | — |
| dead-export-and-test-seam-gates | not-started (P2) | — | — | — |
| typed-step-stubs-and-bounded-spins | not-started (P2) | — | — | — |
| cli-retire-write-and-legacy-aliases | not-started (P2) | — | — | — |
| cli-retire-run-start-pause-and-config | not-started (P2) | — | — | — |
| prompt-corpus-dead-weight-sweep | not-started (P2, prompt corpus) | — | — | — |
| plan-draft-rules-single-source | not-started (P2, prompt corpus) | — | — | — |
| terse-review-role-prompts | not-started (P2, prompt corpus) | — | — | — |
| declarative-prompt-fragment-policy | not-started (P2, prompt corpus) | — | — | — |
| mechanical-cruft-pass | not-started (P3) | — | — | — |
| implement-owns-its-prompt-ids | not-started (P3, prompt corpus) | — | — | — |
| codex-zero-exit-auth-failure-advances-agent-order | merged (seed reaped by #3142) | consumed | 20260830T012500Z-codex-zero-exit-auth-failure-advances-agent-order | [#3139](https://github.com/cbrenner04/jarvis/pull/3139) (closed #3027) |
| per-project-agent-fallback-order | not-started (chess-dogfood; evidence #3026) | — | — | — |
| blocker-contract-credits-existing-section | not-started (chess-dogfood; evidence #3029) | — | — | — |
| pipeline-list-display-retention | not-started (display/TUI) | — | — | — |
| tui-dock-command-grammar-mirrors-cli | not-started (display/TUI) | — | — | — |
| tui-typed-run-steering-clears-command-input | not-started (display/TUI) | — | — | — |
| full-light-review-pipeline | not-started (display/TUI) | — | — | — |
| cleanup-improvements | not-started (scheduled) | — | — | — |
| ready-gate-repair-out-of-diff-edits | not-started (scheduled) | — | — | — |
| implement-retirement-destroys-artifacts-before-materialization | not-started (scheduled) | — | — | — |
| implement-resumes-stalled-unmerged-subspec-chain | not-started (scheduled) | — | — | — |
| watchdog-timers-never-hold-the-event-loop | not-started (pin-test seed from #3060 hand-finish) | — | — | — |
| implement-publication-reuses-closed-same-branch-pr | not-started (point fix hand-published once as #3069) | — | — | — |
| implement-completes-without-publishing | held (verify-or-reap; #3088; 2026-08-30 counter-evidence) | — | — | — |
| plan-draft-contract-miss-reprompts-before-blocking | held (#3114; pending split-spec-guidance / plan-draft-rules) | — | — | — |
| mutation-verifier-masks-type-generic-brackets | RE-SCOPED + removed 2026-08-30 → `mutation-verifier-scanner-based-candidates` (masking-loop approach a dead end; pipeline PRs #3164/#3166/#3169 closed unlanded; spec never on main) | — | — | — |
| diff-derived-verifier-resolves-split-test-files | implemented by hand 2026-08-30 (seed removed) — `resolveSiblingKillingTests` fallback to `<stem>-*.test.ts`, paired with restored implement/repair killing-test authoring rule (`IMPLEMENT_WRITE_STEP_RULES`) | — | — | hand PR |
| idle-watchdog-counts-worktree-filesystem-activity | not-started (new 2026-08-30 #3153; intake #3150) | — | — | — |
| stall-settlement-preserves-agent-stdout | not-started (new 2026-08-30; intake #3151) | — | — | — |
| idle-output-timeout-preserves-committed-progress-resumable | not-started (new 2026-08-30; intake #3152) | — | — | — |
| plan-draft-shape-accepts-nested-stage-layout | not-started (new 2026-08-30; intake #3156; pairs with #3154) | — | — | — |
| mutation-verifier-serializes-per-file-candidates | not-started (NEW 2026-08-30 PM; P0 mutation-gate — concurrent same-file writes cause nondeterministic false survivors; found hand-finishing #3173) | — | — | — |
| retire-mutate-dsl-from-default-write-step-rules | not-started (NEW 2026-08-30 PM; prompt-corpus — intent still injects retired `@mutate`/guard-inversion rules; contaminated 3/6 fresh ready-intents #3178/#3179) | — | — | — |
| pipeline-fan-out-lanes-serial-chained-bases | not-started | — | — | — |
| pipeline-fan-out-per-lane-terminal-settlement | not-started | — | — | — |
| operator-killed-pipeline-stage-is-recoverable | superseded (into pipeline-settlement-derives-from-run-rows) | — | — | — |
| restart-reconciliation-preserves-paused-resumable-runs | superseded (into pipeline-settlement-derives-from-run-rows; evidence #3030) | — | — | — |
| workflow-runner-test-concurrent-load-isolation | superseded (into split-workflow-runner-resume-machines; verify-or-reap) | — | — | — |
| concurrent-load-suite-margin-check | held (demoted, verify-or-reap at re-triage) | — | — | — |
| daemon-test-concurrent-load-isolation | held (demoted, verify-or-reap at re-triage) | — | — | — |
| configure-pipeline-supersede-policy | held (demoted; re-scope post-settlement) | — | — | — |
| settle-superseded-pipeline-prs | held (demoted; re-scope post-settlement) | — | — | — |
| retire-superseded-pipeline-branches | held (demoted; re-scope post-settlement) | — | — | — |
| rename-pipeline-lane-persistence | held (demoted; post-settlement rename lane) | — | — | — |
| rename-pipeline-lane-rpc | held (demoted; post-settlement rename lane) | — | — | — |
| rename-pipeline-lane-execution | held (demoted; post-settlement rename lane) | — | — | — |
| rename-pipeline-lane-operator-surfaces | held (demoted; post-settlement rename lane) | — | — | — |

## Orphan / standalone ready-intents

Ready-intents whose originating seed is no longer on disk (seed reaped after its `intent` run). `Origin intent` gives the intent PR that produced the ready-intent.

| Ready-intent | Status | Origin intent | Plan | Implement |
| --- | --- | --- | --- | --- |
| pipeline-recover-reaches-review-failed-plan-draft | merged | [#3073](https://github.com/cbrenner04/jarvis/pull/3073) | 20260829T175609Z-recover-review-failed-plan-draft | [#3103](https://github.com/cbrenner04/jarvis/pull/3103) |
| preserve-failed-iteration-work-on-rerun | merged | [#3077](https://github.com/cbrenner04/jarvis/pull/3077) | 20260829T175608Z-record-iteration-commit-failure-cause | [#3100](https://github.com/cbrenner04/jarvis/pull/3100) |
| resume-iteration-commit-failures | merged | [#3077](https://github.com/cbrenner04/jarvis/pull/3077) | 20260829T175608Z-record-iteration-commit-failure-cause | [#3100](https://github.com/cbrenner04/jarvis/pull/3100) |
| daemon-terminal-run-settlement | in-flight | [#3074](https://github.com/cbrenner04/jarvis/pull/3074) | [20260830T025725Z-daemon-terminal-run-settlement](https://github.com/cbrenner04/jarvis/pull/3140) | [#3145](https://github.com/cbrenner04/jarvis/pull/3145) |
| execution-terminal-run-settlement-invariant | in-flight (00 landed #3157; 01 salvaged #3167; 02 deferred) | [#3074](https://github.com/cbrenner04/jarvis/pull/3074) | [20260830T041008Z-execution-terminal-run-settlement-invariant](https://github.com/cbrenner04/jarvis/pull/3149) | [#3157](https://github.com/cbrenner04/jarvis/pull/3157) (00), [#3167](https://github.com/cbrenner04/jarvis/pull/3167) (01, hand-salvaged) |
| cleanup-uses-lossless-git-status | intent-split; plan hand-landed | [#3065](https://github.com/cbrenner04/jarvis/pull/3065) | [20260830T061854Z-cleanup-uses-lossless-git-status](https://github.com/cbrenner04/jarvis/pull/3165) (hand-landed) | — |
| harness-publication-push-uses-explicit-refspec | intent-split; plan hand-landed | [#3072](https://github.com/cbrenner04/jarvis/pull/3072) | [20260830T061852Z-harness-publication-push-uses-explicit-refspec](https://github.com/cbrenner04/jarvis/pull/3165) (hand-landed) | — |
| inject-spec-guidance-agent-core | intent-split | [#3094](https://github.com/cbrenner04/jarvis/pull/3094) | — | — |
| split-spec-guidance-documents | intent-split | [#3094](https://github.com/cbrenner04/jarvis/pull/3094) | — | — |
| daemon-start-sweeps-orphan-gate-children | intent-split (kept; prereqs landed, orthogonal) | [#2828](https://github.com/cbrenner04/jarvis/pull/2828) | — | — |
| daemon-resume-honors-injected-config-path | held (demoted P3; plan #3067 closed as sandbox-unrunnable) | [#3063](https://github.com/cbrenner04/jarvis/pull/3063) | #3067 (closed) | — |

## This-session (2026-08-30) landings, for context

Not seed rows, but they close or advance brief items: #3133 retire-checkpoint-log-events (completes retire-mutation-checkpoint-dsl chain, 4/4), #3134 atomic-terminal-run-settlement-store (implements spec #3096), #3137 pipeline-execution architecture doc (implements spec #3066), #3138 lossless-git-status execution consumer 01+02, #3139 codex-zero-exit-auth, #3140/#3141 the two plans, #3142 stale-codex-seed removal, #3143 share-workflow-start-preparation implement, #3144 this ledger, #3145 daemon-terminal-run-settlement implement, #3146 mutation-verifier-type-generic seed.

## This-session (2026-08-30 overnight) landings

- **#3165** — hand-landed 4 contract-miss-blocked plans in one PR: `dispatch-pipeline-stages-through-shared-preparation` (front-door P1), `durable-run-backed-stage-settlement` (settlement P1), `cleanup-uses-lossless-git-status`, `harness-publication-push-uses-explicit-refspec`. All 5 launched plans blocked at the plan-draft contract check on shape/strictness only (multi-surface-AC prose ×2, nested `v2/` stage layout ×2, one missing index link — evidence for [[plan-draft-shape-accepts-nested-stage-layout]] #3156 and [[plan-draft-contract-miss-reprompts-before-blocking]] #3114); 4 also carried retired `@mutate` checkpoint-DSL from stale pre-retirement ready-intents (scrubbed on hand-land). `canonical-pipeline-execution-state-and-stage-claims` deferred (00/01 subspec near-duplicate).
- **#3167** — hand-salvaged `execution-terminal-run-settlement-invariant` subspec 01 (agent completed it but the commit was blocked by two biome complexity findings). Independent diff review caught a settlement honesty inversion (`runtime_smoke_failed` → `completed`); fixed + killing test added.
- **Pipeline dogfood 64e5e97b** (full-review on `mutation-verifier-masks-type-generic-brackets`): clean single-lane intent → plan → implement; drafts had zero `@mutate` contamination (confirms stale ready-intents, not the current prompts, are the contamination source).
- New seed: `diff-derived-verifier-resolves-split-test-files` (verifier's exact-stem killing-test resolution misses split sibling test files; stranded the subspec-01 salvage at the mutation gate).
- **#3163** — merged at session start to unbreak main (plan.prompt.draft r15 snapshot pin).
- **#3170** — `dispatch-pipeline-stages-through-shared-preparation` (front-door P1) implemented + hand-finished. Stranded at the mutation gate on `missing-killing-test` (co-location); hand-added a co-located killing test for `chainedImplementWorkflowDeps`. Independent review verdict SHIP.
- **#3172** — mutation-gate unblock (operator hand-fix, not driven through Jarvis): the `retire-mutation-checkpoint-dsl` work stripped the killing-test authoring rule from implement/repair prompts (`IMPLEMENT_WRITE_STEP_RULES = filterPlanDraftStepRules(...)`) while keeping the diff-derived verifier fully strict; restored a clean authoring rule (Fix A) + `resolveSiblingKillingTests` sibling-test resolver fallback (Fix B, implements+removes `diff-derived-verifier-resolves-split-test-files` seed). Needed a daemon restart to take effect.
- **mv (`mutation-verifier-masks-type-generic-brackets`) NOT landed:** full-review pipeline dogfood ran intent→plan→implement→review end-to-end and the review correctly caught a real coverage gap, but the fix strands on an **equivalent mutation** (`depth > 0` loop bound) the gate has no escape hatch for. Pipeline PRs #3164/#3166/#3169 closed unlanded; seed + spec remain. New seed: `mutation-gate-equivalent-mutation-escape-hatch`.
- **`durable-run-backed-stage-settlement` implement:** first attempt (#3171) stranded at the mutation gate pre-fix; after #3172 + daemon bounce, abandoned the stale workspace (`cleanup --abandon`, closed #3171) and re-ran off the fixed main. Re-run validated Fix A (agent authored a co-located test this time) but stranded on mutation-coverage-completeness in a relocated mapping fn; **published draft #3173, banked review-SHIP** (see report `20260830T144234Z-overnight-mutation-gate.md` § Handoff for how/when to land).
- **Four-seed mutation-gate plan (P0):** `mutation-gate-equivalent-mutation-escape-hatch` → `implement-verifies-mutations-in-loop` → `mutation-verifier-scanner-based-candidates` (re-scopes/removes the masking-loop `mutation-verifier-masks-type-generic-brackets` seed) → `mutation-gate-resolves-importer-killing-tests`. All seeded this session; in-loop verification is the linchpin.
- Parallelization experiment: two concurrent implements (`dispatch` + mv pipeline) ran ~40 min with zero idle-output false-kills under the 15-min idle budget — the "serial only" guidance is calibrated to a tighter budget.

## This-session (2026-08-30 PM continuation)

- **#3173 (`durable-run-backed-stage-settlement`, settlement P1) LANDED** — hand-finished the banked review-SHIP draft: added exhaustive branch-killing tests to `pipeline-stage-settlement.test.ts`, ticked ACs (already ticked), archived spec to `completed/`, admin-merged. The SHIP-reviewed production diff was untouched. Advances `pipeline-settlement-derives-from-run-rows`.
- **Mutation-verifier concurrency race found + seeded (`mutation-verifier-serializes-per-file-candidates`, NEW P0).** Hand-finishing #3173 exposed it: `verifyCandidates` tests every candidate via `Promise.all`, and `testCandidate` mutates the **shared** production file in place → concurrent same-file candidates clobber each other's write, so a fully-covered candidate is falsely reported `surviving-mutation`, on a *different line each run* (three runs on one clean tree: line 43, 27, 27). Manual serial flip+test kills every reported survivor. Strong candidate for the dominant "can't reproduce the survivor" strand root the session has been hand-finishing.
- **`@mutate` contamination root found + seeded (`retire-mutate-dsl-from-default-write-step-rules`, NEW).** `DEFAULT_WRITE_STEP_RULES` still carries the retired `@mutate`/guard-inversion lines; `filterPlanDraftStepRules` strips them for implement/plan, but intent-split injects the raw rules → 3/6 fresh ready-intents this session (`resolve-importing-killing-tests`, both idle-timeout) carry dead `@mutate` in ACs. Completes the `retire-mutation-checkpoint-dsl` chain's intent-path gap. Mitigation until landed: scrub `@mutate` from fresh ready-intents before planning.
- **Mutation-gate P0 chain + watchdog first slice through `intent`:** escape-hatch seed → ready-intents `accept-exact-equivalent-mutation-directives` + `persist-accepted-equivalent-mutation-events` (#3180); `mutation-verifier-scanner-based-candidates` → `derive-mutation-candidates-from-typescript-scanner` (#3177); `mutation-gate-resolves-importer-killing-tests` → `resolve-importing-killing-tests` (#3178); `idle-output-timeout-preserves-committed-progress-resumable` → `idle-timeout-checkpoint-resumability` + `idle-timeout-resume-admission` (#3179). All 4 intent PRs merged. **Plan `accept-exact-equivalent-mutation-directives` in flight** (foundation; no `@mutate`, no prereqs).

## Gaps / low-confidence

- `harness-publication-push-uses-explicit-refspec`, `inject-spec-guidance-agent-core`, `split-spec-guidance-documents`, `cleanup-uses-lossless-git-status`: confirmed as landed ready-intents (intent PRs verified), but no plan-spec dir or implement PR was verifiable from the brief or git — left `—`. May be planned/implemented under names not matched here.
- `execution-terminal-run-settlement-invariant`: the terminal-honesty seed produced two ready-intents; the atomic-store spec (#3096/#3134) and the #3140 daemon plan belong to this lineage, but the exact 1:1 ready-intent→spec split is inferred, not stated verbatim.
- `implement-publication-reuses-closed-same-branch-pr`: a point fix shipped once by hand as #3069 for the deferred-settlement spec, but the general seed has no dedicated spec/implement — status `not-started` reflects the seed, not the one-off hand-fix.
