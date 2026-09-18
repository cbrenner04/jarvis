# Structural-recovery traceability ledger

Supplemental to [`structural-recovery-brief.md`](./structural-recovery-brief.md). One row per open item in `v2/spec/`: what it is, what it waits on, and the last evidence. Rebuilt 2026-09-18 from a source audit of every item against `main` @ `368dfd9ca`; session narratives live in `reports/`, not here. Line numbers inside seeds drift; treat them as pointers and verify against `main` before planning. When an item lands, delete its row and add one line under § Reaped with the PR.

## Open specs (7)

| Spec | Plan PR | Subspecs | Status | Unblocks |
| --- | --- | --- | --- | --- |
| `20260910T230153Z-surviving-mutation-settlement-records-killing-set` | #3751 | 1/2 | 00 landed #3787 (index box ticked 2026-09-18); 01 open, its `run list` column arithmetic corrected to 17→19 | `mutation-repair-commits-pushed-before-settlement` |
| `20260911T142827Z-cleanup-archives-hand-landed-specs` | #3784 | 0/1 | Valid; `cleanup.ts` still skips `no durable implementation branch`; `completedSpecEligibility` exists to reuse | — |
| `20260911T154954Z-tui-consumes-retained-pipeline-list` | #3791 | 0/2 | Pinning spec, valid; stale refs corrected (`tui-entry.test.ts`, single stable connection post-#3897) | — |
| `20260912T162038Z-bulk-terminal-run-dismissal-cli` | #3805 | 0/1 | Valid; store + RPC landed #3792, CLI still `argv.length !== 1` | — |
| `20260912T174755Z-stage-success-reopens-skipped-successors` | #3821 | 0/1 | Valid; `reopenProvisionalSkippedStages` has zero production callers; intent.md transaction wording aligned to subspec 2026-09-18 | `branch-resume-admits-skipped-successor-lane` |
| `20260912T175012Z-persist-gate-refusal-recovery-state` | #3822 | 0/2 | Valid; cause lives only on the log event, no durable column | `redrive-slot-refused-gates` |
| `20260912T175013Z-serve-canonical-failures-from-daemon` | #3823 | 0/5 | Valid; nothing landed. Prereq 2 only partly true (producers: ready gate, publication; not intent/plan/implement) — subspecs 01/03 fall back to the composer | `render-operator-failures-consistently` |

Landing note: specs 1/01, 6 and 7 all widen `RunOperatorError` / `TerminalRunSettlementEvidence` / `run.ts` columns and the same docs; land serially.

## Ready-intents (11)

| Ready-intent | Status | Blocked on |
| --- | --- | --- |
| `owning-daemon-writes-invocation-settled-marker` | **dispatchable** — store landed #4011, zero callers of `writeWorkflowInvocationSettledMarker` | — |
| `run-ad-hoc-terminal-derives-from-settled-marker` | `invocationTerminal` still keys on row times + liveness | previous row |
| `cleanup-reaps-orphan-session-logs` | **dispatchable** — both prereqs landed (#3918, #3937); reaper still `readdirSync` + skip-unparsable | — |
| `explicit-reset-flag-names-continue-path` | **dispatchable** — #4014 landed; refusal text names only hand-finish / `--abandon` | — |
| `branch-resume-admits-skipped-successor-lane` | `scanBranchSuffixForAdmission` admits only `failed` | spec stage-success-reopens-skipped-successors |
| `branch-resume-refusal-names-blocking-row` | refusal carries `status` only, CLI prints bare reason | previous row |
| `redrive-slot-refused-gates` | no `redrive` symbol in daemon | spec persist-gate-refusal-recovery-state |
| `report-gate-refusal-causes` | one undifferentiated `gate_invocation_refused` op | previous row |
| `render-operator-failures-consistently` | no shared formatter; TUI dumps raw `failureDetail` | spec serve-canonical-failures-from-daemon |
| `mutation-repair-commits-pushed-before-settlement` | `settleMutationRepairExhausted` commits, never pushes | spec killing-set / 01 |
| `repair-exhausted-error-names-site-and-killing-set` | `mutation_repair_exhausted` op spreads no site fields | previous row |

## Seeds (36)

P is the brief's priority. Issue is the intake issue where one exists.

| Seed | P | Issue | Status (2026-09-18 audit) |
| --- | --- | --- | --- |
| `ready-gate-autofix-strands-on-unfixable-lint` | P0 | — | open; `runBuiltInReadyGateAutofixBiome` throws on any non-timeout non-zero; sibling `runCompletionFormat` has the right policy |
| `ready-gate-repair-out-of-diff-edits` | P0 | #3040 | open; recurred #3894, #3897, #3951; dangling sequencing link removed; steering-at-failing-step decision added |
| `render-observer-verification-keeps-a-fixed-deadline` | P0 | — | open (#3833 = seed PR); `runScopedTests` called with no options at two sites |
| `gate-allowset-derivation-fails-on-external-spec-home` | P0 | #3423, #4004 | open; both dead ends intact; wording moved off `plan.commit: false` |
| `rebased-lane-cannot-publish-on-non-force-push` | P0 | — | open; predicted from #4014 review, not yet observed |
| `publication-failures-settle-failed` | P0 | — | open; `completionCommitFailed` writes `completed`; #3907 special case still at `operator-incidents.ts` |
| `implement-admission-persists-its-run-row` | P0 | — | open; rewritten around root cause (`linkedImplementRoutingFailureOutcome` phantom id); stale decision 3 dropped |
| `wal-lock-holder-child-exits-silently` | P0 | — | open; `subprocess-marker.ts` `end` rejection carries no stderr/exit |
| `coscheduled-test-pair-strands-runs-terminally` | P0 | — | trimmed to scheduling half; probe half landed #3990/#3995 |
| `pipeline-resume-resumes-a-resumable-implement-row` | P1 | — | open; widened #4016 (any resumable kind recovered by `run resume` orphans its stage); stray AC moved into section |
| `resume-surfaces-admission-gate-refusal` | P1 | — | open; preflight refusal text reaches only detached dispatch |
| `interrupted-pipeline-stage-cannot-be-resumed` | P1 | #2996 | **new** — carved from the closed settlement seed; `resumeDeferredRefusalApplies` still refuses `interrupted` |
| `stale-reset-destroys-commits-for-external-specs` | P1 | #3433 | rewritten: branch deletion closed by #4014; gate 2 still blind to external trees; tip SHA still missing |
| `implement-retirement-destroys-artifacts-before-materialization` | P1 | — | open; `--base <own-branch>` still destroys then fails; plan-side `validateExplicitPlanBase` is the pattern |
| `abandon-refuses-unlanded-work-with-no-pr` | P1 | — | open; `runAbandonCommand` gates only on open/ready PRs; `carriesNoUnlandedCommits` exists |
| `retention-tiers-for-session-logs-and-telemetry` | P1 | — | open; dependency landed; sequence after `cleanup-reaps-orphan-session-logs` |
| `worktree-materialization-fails-on-committed-node-modules-symlink` | P1 | #4003 | half landed (#3022 completion-side exclusion); link-path `lstat` and iteration-commit pathspec remain |
| `review-roles-check-falsifiability-not-plausibility` | P2 | — | open; no falsifiability mandate in `prompts/implement/review-*.md` |
| `implement-respects-target-repo-doc-layout` | P2 | #3426 | open; leak 3 closed by #4029; `intent-split.test.ts` pins leak 1 |
| `intent-split-covers-sibling-repo-surfaces` | P2 | #3439 | re-scoped to split-internal prerequisite consistency (`siblings` was v1-only) |
| `detached-pipeline-plan-stage-consumes-ready-intents` | P2 | #3041 | AC2 landed #3534, AC3 landed #3657; in-repo git-chained silent skip remains; chosen mechanism over the retired merge-at-gate seed |
| `per-project-config-overrides-seam` | P2 | #3026, #3150 | open; `agents` / `idleOutputTimeoutMs` machine-level only |
| `implement-can-run-integration-slice-tests` | P2 | — | re-scoped to measurement criteria after #3867 |
| `mutation-verifier-ignores-whitespace-only-line-changes` | P2 | — | open; no normalized base-line comparison |
| `self-parsing-structural-tests-can-bind-to-their-own-fixtures` | P2 | — | open; scope corrected to one file |
| `completed-write-step-rows-stamp-finished-at` | P2 | — | rewritten; producer fixed incidentally by #3982, fallback UPDATE + backfill + test remain |
| `serial-rerun-includes-frozen-v1` | P2 | — | open; `CLAUDE.md` still says bare `bun test` |
| `non-terminating-mutation-settlement-names-its-site` | P2 | — | open; one missing spread in `publicationLoopFinishedBase`; sequence after killing-set 01 |
| `superseded-pipeline-pr-hygiene` | P2 | — | unblocked by #3745; absorbs stacked-PR cleanup from the retired merge-at-gate seed |
| `pipeline-fan-out-per-lane-terminal-settlement` | P2 | — | ready-flip half served by #3970; per-lane `merge` + spurious `failed` remain; doc target moved to `pipeline-execution.md` |
| `pipeline-fan-out-lanes-serial-chained-bases` | P2 | — | open; prerequisite (per-lane settlement) not landed |
| `agent-confinement-is-per-vendor-and-unexpressed` | P3 | #1453 | open; depends on `per-project-config-overrides-seam` |
| `cli-retire-run-start-pause-and-config` | P3 | — | open decision on `run pause` (see brief) |
| `tui-dock-command-grammar-mirrors-cli` | P3 | — | open; land with or after `tui-typed-run-steering-clears-command-input` |
| `tui-typed-run-steering-clears-command-input` | P3 | — | open; `runSteeringAction(method); return;` still no clear |
| `daemon-status-reports-stopped-on-a-busy-daemon` | P1 | — | open (#3832 = seed PR); `probeSocket` still `catch → false`; classifier names refreshed |

## Open intake issues without a seed

Issue #3029 (mechanisms 2 and 4 of the `## Blocker` contract; mechanism 1 fixed #3670, 3 earlier), #3417 (resolution half closed #3534/#3543; remainder is `gate-allowset-derivation-fails-on-external-spec-home`), #3372 (defect 1 fixed #3669; defect 2's incident half landed #3853 — closable after confirming on `main`). #3949 and #3974 are fully landed and should be closed (brief § Contradictions).

## Reaped 2026-09-18

| Item | Reason |
| --- | --- |
| seed `cleanup-never-reaps-socketless-daemon-pid-and-log-pairs` | landed #3903 (`reapLegacyDaemonArtifacts`, test at `cleanup.test.ts`); operator home has zero keyed pairs |
| seed `run-list-cannot-reach-superseded-daemon-runs` | landed #3866, #3874, #3894/#3895, #3897; premise (digest sockets) retired |
| seed `tui-follows-daemon-source-revision` | landed #3904, #3912 (`tui-revision-follow.ts`); archived #3923 |
| seed `implement-resumes-stalled-unmerged-subspec-chain` | landed #4014 (`evaluateCommittedLaneContinuation`) + #3982/#3987 |
| seed `quota-classification-covers-every-step-role` | AC1 carved and landed (spec `quota-signal-outranks-transient-marker`), AC2 landed #3853; remaining decision had no criterion |
| seed `pipeline-settlement-derives-from-run-rows` | landed #3745, #3672; #2996 remainder carved into `interrupted-pipeline-stage-cannot-be-resumed` |
| seed `merge-pipeline-stage-pr-at-its-approval-gate` | contradicted `detached-pipeline-plan-stage-consumes-ready-intents`; self-admitted merge-at-gate alone is a no-op; stacked-PR half moved to `superseded-pipeline-pr-hygiene` |
| ready-intent `single-spec-home-predicate` | landed #3916/#3917 (`specsHome`, `resolveSpecsHome`); residual is a two-line wrapper, not worth a lane |

## Landed 2026-09-16 → 2026-09-18 (for tracing; details in `reports/`)

`implement-pr-body-is-reviewer-facing` #3941/#3947/#3951; `test-suite-wall-clock` #3953/#3956/#3957/#3972; `pipeline-lane-ready-pr-notifies` #3970; telemetry caps #3937; `resume-failed-link-row-through-workflow` #3977/#3982; `run-admission-stamps-its-owner` #3981/#3987; `intent-landing-accepts-no-prerequisites` #3979/#3988; `artifact-count-exempts-references-and-rules-out-clauses` #3984; base-ref probe #3990/#3995; `daemon-retire-trigger-logging` #3994; `workflow-invocation-settled-marker-store` #4011; `mutation-verifier-skips-test-support-files` #4012; `decisions-ledger-prompt-requires-bullet-list` #4013; `redispatch-continues-committed-lane` #4014; `plan-draft-normalizer-bulletizes-decisions` #4017; `daemon-committed-successor-watch` #4022; `stage-settlement-foreign-owner-liveness` #4023; `recover-admits-landing-failed-plan-write-row` #4025; v1 prompt-artifact retirement #4028; standing-rules fragments + staged lint autofix #4029.
