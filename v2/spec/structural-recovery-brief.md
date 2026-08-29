# Structural recovery brief

Successor to `pipeline-attribution-and-hygiene-brief.md` (retired in this rewrite; every open row is carried below or lives in `seeds/`). Sourced from the 2026-08-29 code review of `v2/src` (four fan-out audits: dispatch seams, cruft, fix-commit taxonomy, CLI surface). This doc is the phase tracker: tick as work lands.

## Why this phase

237 of 376 v2 code commits since 2026-07-15 were fixes, and they cluster on a handful of structural seams — not scattered sloppiness. A pipeline stage *is* a workflow run (both paths end in the same `handleWorkflowStart`); the bug stream comes from what the pipeline layer re-implements around it and from terminal writes that only happen on the happy path.

| Defect class (6-week fix taxonomy) | Fixes | Root mechanism |
| --- | --- | --- |
| Runner/write-loop settlement + resume honesty | 30 | terminal state written on happy path only |
| Mutation/plan-contract verifier | 26 | churn incl. one full revert |
| Cleanup/worktree management | 27 | dead claims, dirty-tree debris |
| Pipeline stage settlement/lifecycle | 24 | stage row copies run status, drifts off-happy-path |
| Daemon restart/reconciliation | 23 | redrive patches on the settlement copy |
| Error attribution ("the row lied") | 18 | same honesty mechanism |
| Ready-gate repair scope | 14 | repair escapes the diff |
| Dispatch parity CLI vs daemon | 11 | config assembled twice, one copy stale |

The five structural retirements that close whole classes: one dispatch front door, settlement derived from run rows, atomic terminal writes, the workflow-runner/daemon module splits, and real dead-export/test-seam gates.

## In flight (2026-08-29)

- **PR #3060** (`impl/config-parity-01-02`) — **hand-finished 2026-08-29, awaiting green CI + merge.** Subspecs 01+02 complete, all gates green locally. The test-file hang's true cause was stub steps without `worktree` (the stamp threw before `wait()`, starving microtask spin loops) — not timers; the watchdog unrefs landed anyway as hygiene, leaving [[watchdog-timers-never-hold-the-event-loop]] as a pin-test seed. On merge, reap [[pipeline-dispatch-threads-project-ready-and-fix-commands]].
- **Spec `20260829T023500Z-deferred-settlement-resume-preserves-pr-evidence`** — next to run. Point fix for the sharpest dogfood blocker; later subsumed by [[pipeline-settlement-derives-from-run-rows]] (which retires the deferred-settlement machinery it patches). Seeds for both in-flight specs stay in `seeds/` until landed, then reap.

## Priority-ordered work

| P | Item | Delivers |
| --- | --- | --- |
| **P0** | Land #3060 + the deferred-settlement spec | Watchdogs arm on pipeline runs; configured ready/fix commands honored; review-bearing pipelines stop stranding their PR |
| **P0** | [[pipeline-architecture-doc]] | Cheap; states the target the P1 restructures converge on |
| **P1** | [[pipeline-dispatch-shares-cli-front-door]] | Retires the remaining dispatch-assembly copies (posture, review passes, stale-reset, admission, context source) |
| **P1** | [[pipeline-settlement-derives-from-run-rows]] | Retires copy-then-redrive settlement, both claim mechanisms, the dual `derivePipelineState`; absorbs [[operator-killed-pipeline-stage-is-recoverable]] and [[restart-reconciliation-preserves-paused-resumable-runs]] planning |
| **P1** | [[terminal-state-honesty-invariant]] | One atomic terminal-write owner; closes the 48-fix honesty class |
| **P1** (small, any time) | [[unify-git-status-parsing]], [[daemon-resume-honors-injected-config-path]], [[implement-boundary-commit-failure-strands-authored-work]], [[harness-publication-push-uses-explicit-refspec]], [[plan-review-failure-preserves-and-recovers-the-good-draft]] | Live bugs with evidence; independent of the restructures |
| **P2** | [[split-workflow-runner-resume-machines]] | 5,141-line file split; twin resume machines merged (`resumable: true` bug); absorbs issue #2181 and the demoted load-isolation trio |
| **P2** | [[split-daemon-run-control-handlers]] | 1,318-line closure split; WeakMap back-channel and production test seams retired; guard generalized |
| **P2** | [[dead-export-and-test-seam-gates]] | knip-style gate; 6 dead exports; repair-fence bypass out of production |
| **P2** | [[typed-step-stubs-and-bounded-spins]] | Shared typed step factory + bounded-spin helper; retires the two scaffolding hazards behind the #3060 silent hang |
| **P2** | [[cli-retire-write-and-legacy-aliases]] → [[cli-retire-run-start-pause-and-config]] | CLI trim, sequenced (pause plumbing before `run start`); dismiss pairs merged |
| **P3** | [[mechanical-cruft-pass]] | Shared helpers, path derivations, dead flag, migration squash |
| **P3** | Re-triage demoted seeds | rename-lane family and supersede family re-scope against the post-settlement seam; load trio verify-or-reap |

Chess-dogfood seeds ([[per-project-agent-fallback-order]], [[codex-zero-exit-auth-failure-advances-agent-order]], [[blocker-contract-credits-existing-section]]) and display/TUI seeds ([[pipeline-list-display-retention]], [[tui-dock-command-grammar-mirrors-cli]], [[tui-typed-run-steering-clears-command-input]], [[full-light-review-pipeline]], [[cleanup-improvements]], [[ready-gate-repair-out-of-diff-edits]], [[implement-retirement-destroys-artifacts-before-materialization]], [[implement-resumes-stalled-unmerged-subspec-chain]]) keep their prior priorities; schedule them between restructure landings.

## CLI surface verdicts (2026-08-29 inventory)

Keep: `daemon start|status|stop` (runtime-smoke verifier shells them), `run list|log|wait|kill|resume` (documented recovery verbs; `run kill` is the only abort for a live pipeline stage), `run workflow *`, `pipeline *`, `cleanup`, `tui`, `init`. Retire now: `write`, the three legacy aliases, `TuiDaemonClient.start`. Retire sequenced: `run pause` → `run start` → `config`. Merge: the run/pipeline dismiss pairs. Details and evidence in the two CLI seeds.

## Rewrite ledger (2026-08-29)

- Retired briefs: `tui-command-center-brief.md` (phase complete 2026-08-10), `tui-pipeline-continuation-brief.md` (every row landed or carried: attention-segment #3007, publishes-despite-no-work-shrink #3015/#3018, guard reprompts #2853), `pipeline-attribution-and-hygiene-brief.md` (superseded here).
- Reaped: ready-intent `landing-failed-names-its-cause` (#2980 verified on `main`).
- Demoted to seeds with inline notes: `concurrent-load-suite-margin-check`, `daemon-test-concurrent-load-isolation`, `workflow-runner-test-concurrent-load-isolation` (verify-or-reap), `rename-pipeline-lane-{persistence,rpc,execution,operator-surfaces}` (post-settlement; persistence slice absorbs the `workflowInvocationId`→entry-run-id rename), `configure-pipeline-supersede-policy`, `settle-superseded-pipeline-prs`, `retire-superseded-pipeline-branches` (re-scope post-settlement).
- Kept ready-intent: `daemon-start-sweeps-orphan-gate-children` (prereqs landed, orthogonal).
- New seeds from the review and the #3060 hand-finish: the fourteen linked above.

Test strategy unchanged: pure functions + injected input hook for TUI; daemon/state tests for pipeline items; no assertion dropped in any split (inventory-diff before merge).
