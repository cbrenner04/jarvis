# Structural-recovery traceability ledger

Supplemental to `structural-recovery-brief.md`. Tracks each `seeds/*.md` seed through the pipeline: seed → ready-intent(s) → plan → implement. **Point-in-time snapshot as of 2026-09-05 (compaction pass).** PR cells link to the GitHub PR that landed that stage; unverifiable cells are `—`. Regenerate by re-tracing seeds/ready-intents against the brief and `git log --grep`; session narratives live in `reports/`, not here.

A seed with multiple ready-intents spans one row per ready-intent; the `Seed` and `Status` cells are filled on the seed's first row only. A seed file is typically reaped once its `intent` run lands, so an already-split seed's ready-intents appear in the orphan table below rather than beside a seed row. Rows for reaped/landed seeds are kept for traceability.

## Seed ledger

| Seed | Status | Ready-intent | Plan | Implement |
| --- | --- | --- | --- | --- |
| pipeline-dispatch-shares-cli-front-door | **COMPLETE (4/4); seed reaped 2026-09-05** (audit: `FIXED_REVIEW_PASSES` in the resolver's forbidden list) | admit-pipeline-recovery-through-workflow-start | [20260831T031314Z](https://github.com/cbrenner04/jarvis/pull/3225) | [#3226](https://github.com/cbrenner04/jarvis/pull/3226) |
| | | dispatch-pipeline-stages-through-shared-preparation | [#3165](https://github.com/cbrenner04/jarvis/pull/3165) (hand-landed) | [#3170](https://github.com/cbrenner04/jarvis/pull/3170) |
| | | require-complete-pipeline-context | [#3148](https://github.com/cbrenner04/jarvis/pull/3148) | [#3155](https://github.com/cbrenner04/jarvis/pull/3155) |
| | | share-workflow-start-preparation | [#3141](https://github.com/cbrenner04/jarvis/pull/3141) | [#3143](https://github.com/cbrenner04/jarvis/pull/3143) |
| pipeline-settlement-derives-from-run-rows | **the active structural item** — slice 1 landed; absorbed the operator-killed (#2996) and restart-reconciliation (#3030) seeds 2026-09-05; #3478 corrected the entry-row-only premise | durable-run-backed-stage-settlement | [#3165](https://github.com/cbrenner04/jarvis/pull/3165) (hand-landed) | [#3173](https://github.com/cbrenner04/jarvis/pull/3173) (archived) |
| | | canonical-pipeline-execution-state-and-stage-claims | **rewritten 2026-09-05** against landed claim machinery; next slice | — |
| | | daemon-terminal-run-stage-settlement | blocked on canonical | — |
| implement-admits-externally-landed-specs (#3122) | **CLOSED 2026-09-02** — admit #3272 → route #3297 → chain #3350 → archive #3360/#3363 | — | — | — |
| all-spec-documents-external-capable | in-flight — foundation [#3483](https://github.com/cbrenner04/jarvis/pull/3483); [[pipeline-external-chained-resolution]] spec active (plan [#3484](https://github.com/cbrenner04/jarvis/pull/3484), covers #3374) | — | — | — |
| split-workflow-runner-resume-machines | **COMPLETE 2026-09-03** (#3351, #3380, #3388, #3393) | — | — | — |
| split-daemon-run-control-handlers | **COMPLETE 2026-09-03** (#3311, #3312, #3364, #3379, #3386, #3392, #3394) | — | — | — |
| dead-export-and-test-seam-gates | intent-split → the hygiene RIs below | — | — | — |
| typed-step-stubs-and-bounded-spins | **DONE #3352** | — | — | — |
| cli-retire-write-and-legacy-aliases | **COMPLETE** — aliases #3356, TuiDaemonClient.start #3349, `jarvis write` #3445 (hand-landed; spec archived 2026-09-05) | — | — | — |
| cli-retire-run-start-pause-and-config | not-started (P2, sequenced: pause plumbing before `run start`) | — | — | — |
| prompt-corpus-dead-weight-sweep | landed via #3259/#3260/#3265 | — | — | — |
| plan-draft-rules-single-source | landed via #3317 (dedupe draft rules) | — | — | — |
| terse-review-role-prompts | landed via #3342/#3382 | — | — | — |
| declarative-prompt-fragment-policy | intent-split → `declarative-fragment-policy-single-assembler` RI | — | — | — |
| mechanical-cruft-pass | not-started (P3) | — | — | — |
| implement-owns-its-prompt-ids | intent-split → implement-owned-prompt-artifacts / v1-migration / v2-wiring RIs | — | — | — |
| per-project-agent-fallback-order | folded into [[per-project-config-overrides-seam]] 2026-09-05 (#3026) | — | — | — |
| blocker-contract-credits-existing-section | not-started (chess-dogfood; #3029) | — | — | — |
| pipeline-list-display-retention / tui-dock-command-grammar / tui-typed-run-steering / full-light-review-pipeline | parked (display/TUI) | — | — | — |
| cleanup-improvements | not-started — **absorbed session-log retention, dead-daemon files, spec-scoped archival 2026-09-05** | — | — | — |
| ready-gate-repair-out-of-diff-edits | **fence policy decided 2026-09-05** (absolute fence + honest settlement, closes the #3040 dead-end); chain head before [[remove-ready-gate-repair-fence-bypass-from-production]] | — | — | — |
| implement-retirement-destroys-artifacts-before-materialization | not-started; fresh evidence #3433 | — | — | — |
| implement-resumes-stalled-unmerged-subspec-chain | not-started | — | — | — |
| notification-sweep-derives-bounded-incident-set | landed 3/5, CPU 73–98% → 4.6–15%; 03/04 residual | (see orphan table) | — | #3384, #3391, #3396 |
| structural-invariants-key-on-behavior-not-incidental-structure | in-flight — audit doc [#3485](https://github.com/cbrenner04/jarvis/pull/3485); locator spec active (0/8); anchors RIs queued behind it | — | [#3442](https://github.com/cbrenner04/jarvis/pull/3442) (hand-landed), [#3447](https://github.com/cbrenner04/jarvis/pull/3447) | — |
| watchdog trio (idle-activity / stall-stdout / committed-progress) | **COMPLETE** #3218, #3227, #3189+#3194; sidecar filter #3278 | — | — | — |
| watchdog-timers-never-hold-the-event-loop | not-started (pin-test seed; audit confirmed the `.unref()` is still absent) | — | — | — |
| implement-publication-tail | **merged carrier 2026-09-05** (former implement-completes-without-publishing [verify-or-reap] + reuses-closed-same-branch-pr [live again 2026-09-03 via #3396]; includes the `defaultGhReadyFlip` state-filter gap) | — | — | — |
| plan-draft-contract-miss-reprompts-before-blocking | largely fixed [#3348](https://github.com/cbrenner04/jarvis/pull/3348) (detection bug); bare-filename residue + #3383 evidence | — | — | — |
| mutation-gate P0 chain | **COMPLETE 4/4** — #3188, #3197, #3202, #3195; containment #3211 | — | — | — |
| guard-flip-derivation-crash-is-contained | containment landed #3211; root-cause slice open | — | — | — |
| mutation-verifier-ignores-whitespace-only-line-changes | not-started | — | — | — |
| importer-cap-counts-realized-not-surface-total | **P0 dated fuse** — cap 200, `v2/src` at 165 test files and growing | — | — | — |
| sweep-dead-mutate-directives-from-test-corpus | not-started — 74 files, growing (agents copy directives forward) | — | — | — |
| bind-verifier-spawns-to-run-termination | seeded [#3489](https://github.com/cbrenner04/jarvis/pull/3489) (the recurring CPU-orphan mode) | — | — | — |
| ci-test-scope-treats-root-docs-as-full / outcome-token-parsing-matches-blocked-in-prose / boundary-split-emits-near-duplicate-subspecs / dismiss-accepts-a-bulk-terminal-selection / notification-incidents-roll-up-to-the-invocation | not-started (small, independent) | — | — | — |
| intent-resume-consumes-its-seed | not-started (#3410); pairs with [[detached-pipeline-plan-stage-consumes-ready-intents]] | — | — | — |
| plan-bases-off-a-declared-prerequisite-branch | not-started (#3437); with [[pipeline-fan-out-lanes-serial-chained-bases]] it is the structural answer to stage parallelism | — | — | — |
| abandon-refuses-unlanded-work-with-no-pr | not-started (#3437) | — | — | — |
| pipeline-fan-out-lanes-serial-chained-bases / pipeline-fan-out-per-lane-terminal-settlement | not-started | — | — | — |
| concurrent-load-suite-margin-check | held (verify-or-reap; the two isolation siblings were reaped — `LOAD_SENSITIVE_FILES` supersedes) | — | — | — |
| superseded-pipeline-pr-hygiene | **merged carrier 2026-09-05** (former supersede trio); re-scope post-settlement | — | — | — |
| rename-pipeline-lane-* (×4) | **PRUNED 2026-09-05** — 474 `branchKey` sites / 0 `laneKey`, blocked behind settlement; terminology churn | — | — | — |
| linked-run-rows-resume-and-settle-uniformly | **NEW 2026-09-05 (P0)** — #3462 + #3463 + #3395, one matcher spec | — | — | — |
| pipeline-restart-discards-disposable-stage-state | **NEW 2026-09-05 (operator ask)** — chess 3-lane restart refusals over throwaway state | — | — | — |
| superseded-daemon-releases-run-ownership | NEW 2026-09-05 (#3464) | — | — | — |
| intent-split-covers-sibling-repo-surfaces | NEW 2026-09-05 (#3439) | — | — | — |
| implement-respects-target-repo-doc-layout | NEW 2026-09-05 (#3426) | — | — | — |
| implement-base-fails-closed-on-stale-local-main | NEW 2026-09-05 (#3381) | — | — | — |
| quota-classification-covers-every-step-role | NEW 2026-09-05 (#3372) | — | — | — |
| detached-pipeline-plan-stage-consumes-ready-intents | NEW 2026-09-05 (#3041) | — | — | — |
| per-project-config-overrides-seam | NEW 2026-09-05 (umbrella: #3026, #3150-residue, the readyCommand cascade class) | — | — | — |

## Orphan / standalone ready-intents

Ready-intents whose originating seed is no longer on disk. `Origin intent` gives the intent PR that produced the ready-intent.

| Ready-intent | Status | Origin intent | Plan | Implement |
| --- | --- | --- | --- | --- |
| daemon-terminal-run-settlement | merged | [#3074](https://github.com/cbrenner04/jarvis/pull/3074) | [#3140](https://github.com/cbrenner04/jarvis/pull/3140) | [#3145](https://github.com/cbrenner04/jarvis/pull/3145) |
| execution-terminal-run-settlement-invariant | 00 #3157, 01 hand-salvaged #3167; 02 deferred | [#3074](https://github.com/cbrenner04/jarvis/pull/3074) | [#3149](https://github.com/cbrenner04/jarvis/pull/3149) | [#3157](https://github.com/cbrenner04/jarvis/pull/3157), [#3167](https://github.com/cbrenner04/jarvis/pull/3167) |
| inject-spec-guidance-agent-core / split-spec-guidance-documents | landed (#3253/#3255) | [#3094](https://github.com/cbrenner04/jarvis/pull/3094) | — | [#3253](https://github.com/cbrenner04/jarvis/pull/3253), [#3255](https://github.com/cbrenner04/jarvis/pull/3255) |
| daemon-start-sweeps-orphan-gate-children | **landed #3416/#3431** (gate group only; sibling spawns → [[bind-verifier-spawns-to-run-termination]]) | [#2828](https://github.com/cbrenner04/jarvis/pull/2828) | — | [#3431](https://github.com/cbrenner04/jarvis/pull/3431) |
| daemon-resume-honors-injected-config-path | held (P3; plan #3067 closed sandbox-unrunnable) | [#3063](https://github.com/cbrenner04/jarvis/pull/3063) | #3067 (closed) | — |
| cli/daemon/execution-loop-structural-invariant-test-anchors (×3) + structural-invariant-test-writing-docs | blocked on the locator spec (active, 0/8) | [#3438](https://github.com/cbrenner04/jarvis/pull/3438) | — | — |
| add-v2-dead-export-hygiene-gate / sweep-v2-unreferenced-exports / exclude-test-support-from-production-glob / generalize-production-test-seam-guard | not-started (hygiene family from [[dead-export-and-test-seam-gates]]) | — | — | — |
| dedupe-cli-cruft / dedupe-daemon-cruft / dedupe-execution-loop-cruft | not-started (one shape, three surfaces — plan as one chain) | — | — | — |
| implement-owned-prompt-artifacts → v1-implement-prompt-id-migration → v2-implement-prompt-wiring → implement-prompt-operator-documentation | not-started, strictly serial; operator-doc RI **absorbed document-review-role-prompt-families 2026-09-05** | — | — | — |
| declarative-fragment-policy-single-assembler | not-started | — | — | — |
| merge-publication-resume-twins-compute-resumable | **pure dedup** — its bug landed as #3327; demoted | — | — | — |
| remove-ready-gate-repair-fence-bypass-from-production | sequenced behind [[ready-gate-repair-out-of-diff-edits]] (2026-09-05 fence decision) | — | — | — |
| canonical-pipeline-execution-state-and-stage-claims | rewritten 2026-09-05; next settlement slice | — | — | — |
| cleanup-external-spec-home-lifecycle | not-started | — | — | — |
| align-docs-after-write-retirement | not-started (docs sweep deferred from the retire-write spec) | — | — | — |
| mutation-verifier-prompt-registry-surface | not-started | — | — | — |

## Compaction (2026-09-05)

Executed the 2026-09-05 queue audit plus the operator's restart-pain report: merged the supersede trio → [[superseded-pipeline-pr-hygiene]], the publication-tail pair → [[implement-publication-tail]], the two cleanup-reap seeds + repo-wide-archival gap → [[cleanup-improvements]]; folded the two superseded settlement seeds' evidence into [[pipeline-settlement-derives-from-run-rows]] and deleted them; pruned the four rename-lane seeds; rewrote [[canonical-pipeline-execution-state-and-stage-claims]]; decided the ready-gate fence direction (absolute + honest settlement) and sequenced its chain; merged the two prompt-doc RIs; ticked + archived the retire-jarvis-write spec (#3445); added nine seeds (see table); closed issues #3461, #3465, #3397, #3039, #3368 as verified fixed. Brief rewritten to a standing document — session history lives in `reports/`.

## Gaps / low-confidence

- Four runbook bullets cite seeds that do not exist (`reap-ready-gate-test-children-on-run-termination`, `mutation-checkpoint-verifier-trust`, `a-daemon-lost-run-row-deadlocks-the-daemon`, `gate-repair-fence`) — fix on next runbook pass.
- #3374/#3417 need re-repro after #3483 before their spec drives to implement.
- Statuses in the seed table for pre-2026-09-01 landings are traced from the brief's history, not re-verified by artifact this pass; the 2026-09-05 audit verified the reap set by artifact.
