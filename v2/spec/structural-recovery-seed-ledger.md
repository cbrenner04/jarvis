# Structural-recovery traceability ledger

Supplemental to `structural-recovery-brief.md`. Tracks each `seeds/*.md` seed through the pipeline: seed → ready-intent(s) → plan/spec → implement PR. **Point-in-time snapshot as of 2026-08-30** (post-#3142). PR numbers are filled only where the brief states them explicitly or git log confirms them; unverifiable cells are `—`. Grouped by the brief's priority tiers. Regenerate by re-tracing seeds/ready-intents against the brief and `git log --grep`.

Note on shape: most on-disk seeds are pre-intent (`not-started`) — a seed file is typically reaped once its `intent` run lands, so an already-split seed's ready-intents appear in the orphan table below rather than beside a seed row.

## Seed ledger

| Seed | Status | Ready-intent(s) | Spec / plan | Implement PR(s) |
| --- | --- | --- | --- | --- |
| pipeline-dispatch-shares-cli-front-door | in-flight | admit-pipeline-recovery-through-workflow-start; dispatch-pipeline-stages-through-shared-preparation; require-complete-pipeline-context; share-workflow-start-preparation (intent #3076) | 20260830T025737Z-share-workflow-start-preparation (plan #3141) | — (implement in-flight) |
| pipeline-settlement-derives-from-run-rows | intent-split | canonical-pipeline-execution-state-and-stage-claims; daemon-terminal-run-stage-settlement; durable-run-backed-stage-settlement (intent #3075) | — | — |
| implement-admits-externally-landed-specs | held (P2, deliberately not started; seq. behind front-door) | — | — | — |
| all-spec-documents-external-capable | held (P2, deliberately not started; seq. behind front-door) | — | — | — |
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
| codex-zero-exit-auth-failure-advances-agent-order | merged (seed reaped by #3142) | — (consumed) | 20260830T012500Z-codex-zero-exit-auth-failure-advances-agent-order | #3139 (closed issue #3027) |
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
| implement-publication-reuses-closed-same-branch-pr | not-started (point fix hand-published once as #3069; seed not yet run) | — | — | — |
| implement-completes-without-publishing | held (verify-or-reap; #3088; 2026-08-30 counter-evidence, implements auto-published) | — | — | — |
| plan-draft-contract-miss-reprompts-before-blocking | held (#3114; pending split-spec-guidance / plan-draft-rules) | — | — | — |
| pipeline-fan-out-lanes-serial-chained-bases | not-started | — | — | — |
| pipeline-fan-out-per-lane-terminal-settlement | not-started | — | — | — |
| operator-killed-pipeline-stage-is-recoverable | superseded (absorbed into pipeline-settlement-derives-from-run-rows planning) | — | — | — |
| restart-reconciliation-preserves-paused-resumable-runs | superseded (absorbed into pipeline-settlement-derives-from-run-rows planning; evidence #3030) | — | — | — |
| workflow-runner-test-concurrent-load-isolation | superseded (subsumed by split-workflow-runner-resume-machines; verify-or-reap) | — | — | — |
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

Ready-intents whose originating seed is no longer on disk (seed reaped after its `intent` run). "Origin intent (PR)" replaces the Seed column for traceability.

| Ready-intent | Status | Origin intent (PR) | Spec / plan | Implement PR(s) |
| --- | --- | --- | --- | --- |
| pipeline-recover-reaches-review-failed-plan-draft | merged | plan-review-failure-preserves-and-recovers-the-good-draft (#3073) | 20260829T175609Z-recover-review-failed-plan-draft | #3103 |
| preserve-failed-iteration-work-on-rerun | merged | implement-boundary-commit-failure-strands-authored-work (#3077) | 20260829T175608Z-record-iteration-commit-failure-cause | #3100 |
| resume-iteration-commit-failures | merged | implement-boundary-commit-failure-strands-authored-work (#3077) | 20260829T175608Z-record-iteration-commit-failure-cause | #3100 |
| daemon-terminal-run-settlement | in-flight | terminal-state-honesty-invariant (#3074) | 20260830T025725Z-daemon-terminal-run-settlement (plan #3140) | — (implement in-flight) |
| execution-terminal-run-settlement-invariant | intent-split | terminal-state-honesty-invariant (#3074) | related atomic-store spec #3096 → implement #3134 | — |
| cleanup-uses-lossless-git-status | intent-split (blocked on execution consumer 02, landed #3138) | unify-git-status-parsing (#3065) | — | — |
| harness-publication-push-uses-explicit-refspec | intent-split | harness-publication-push-uses-explicit-refspec (#3072) | — | — |
| inject-spec-guidance-agent-core | intent-split | split-spec-guidance-agent-core (#3094) | — | — |
| split-spec-guidance-documents | intent-split | split-spec-guidance-agent-core (#3094) | — | — |
| daemon-start-sweeps-orphan-gate-children | intent-split (kept; prereqs landed, orthogonal) | reap-ready-gate-test-children-on-run-termination (#2828) | — | — |
| daemon-resume-honors-injected-config-path | held (demoted P3; plan #3067 closed as sandbox-unrunnable) | daemon-resume-honors-injected-config-path (#3063) | plan #3067 (closed) | — |

## This-session (2026-08-30) landings, for context

Not seed rows, but they close or advance brief items: #3133 retire-checkpoint-log-events (completes retire-mutation-checkpoint-dsl chain, 4/4), #3134 atomic-terminal-run-settlement-store (implements spec #3096), #3137 pipeline-execution architecture doc (implements spec #3066), #3138 lossless-git-status execution consumer 01+02, #3139 codex-zero-exit-auth, #3140/#3141 the two in-flight plans, #3142 stale-codex-seed removal.

## Gaps / low-confidence

- `harness-publication-push-uses-explicit-refspec`, `inject-spec-guidance-agent-core`, `split-spec-guidance-documents`, `cleanup-uses-lossless-git-status`: confirmed as landed ready-intents (intent PRs verified), but no plan-spec dir or implement PR was verifiable from the brief or git — left `—`. May be planned/implemented under names not matched here.
- `execution-terminal-run-settlement-invariant`: the terminal-honesty seed produced two ready-intents; the atomic-store spec (#3096/#3134) and the #3140 daemon plan belong to this lineage, but the exact 1:1 ready-intent→spec split is inferred, not stated verbatim.
- `implement-publication-reuses-closed-same-branch-pr`: a point fix shipped once by hand as #3069 for the deferred-settlement spec, but the general seed has no dedicated spec/implement — status `not-started` reflects the seed, not the one-off hand-fix.
