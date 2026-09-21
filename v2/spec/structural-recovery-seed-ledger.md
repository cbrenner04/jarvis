# Structural-recovery traceability ledger

Supplemental to [`structural-recovery-brief.md`](./structural-recovery-brief.md). One row per open item in `v2/spec/`: what it is, what it waits on, and the last evidence. Rebuilt 2026-09-18 from a source audit of every item; refreshed 2026-09-20 against `main` @ `0e1e1e65e`; session narratives live in `reports/`, not here. Line numbers inside seeds drift; treat them as pointers and verify against `main` before planning. When an item lands, delete its row and add one line under § Reaped or § Landed with the PR; no journal paragraphs.

## Open specs (16: 14 landed and awaiting archival, 2 open)

Fourteen dirs below are fully ticked and merged. Cleanup archives a spec only from a run row, and hand-finished lanes have none, so they need an archive PR. Until then each reads as unlanded work.

| Spec | Landed | Note |
| --- | --- | --- |
| `20260910T230153Z-surviving-mutation-settlement-records-killing-set` | #3787 (00), #4102 (01) | chain D spec complete; tails still queued |
| `20260911T142827Z-cleanup-archives-hand-landed-specs` | #4107 | — |
| `20260912T175013Z-serve-canonical-failures-from-daemon` | #4108 | all 5 subspecs; chain C spec complete |
| `20260918T111025Z-publication-failures-settle-failed-writer` | #4088 | ready-intent unreaped |
| `20260918T114137Z-branch-resume-admits-skipped-successor-lane` | #4096 | chain A link 2 |
| `20260918T214241Z-ready-gate-repair-prompt-targets-failing-step` | #4085 | closes #3040 |
| `20260920T173435Z-fence-derivation-failure-settles-honestly` | #4090 | plan #4084; #3423 remainder |
| `20260920T173436Z-cleanup-reaps-orphan-session-logs` | #4086 | plan #4081 |
| `20260920T173436Z-report-gate-refusal-causes` | #4091 | plan #4083; chain B link 3 |
| `20260920T173437Z-explicit-reset-flag-names-continue-path` | #4089 | plan #4082 |
| `20260920T214859Z-subprocess-marker-rejection-carries-cause` | #4097 | plan #4094 closed as subsumed; ready-intent unreaped |
| `20260920T214922Z-declared-isolation-class-for-wall-clock-bounded-suites` | #4098 | plan #4095 closed as subsumed; ready-intent unreaped |
| `20260921T020642Z-branch-resume-refusal-names-blocking-row` | #4110 | plan #4103; chain A complete |
| `20260921T020646Z-publication-failure-rows-migrate-failed` | #4109 | plan #4106 |

Genuinely open:

| Spec | Plan PR | Subspecs | Status | Unblocks |
| --- | --- | --- | --- | --- |
| `20260911T154954Z-tui-consumes-retained-pipeline-list` | #3791 | 0/2 | Pinning spec, valid | — |
| `20260912T162038Z-bulk-terminal-run-dismissal-cli` | #3805 | 0/1 | Implement in flight, PR #4112 open | — |

## Ready-intents (10 queued: 5 live, 3 stale, 2 not startable)

| Ready-intent | Status | Blocked on |
| --- | --- | --- |
| `render-operator-failures-consistently` | **dispatchable** — chain C tail, unblocked by #4108; no shared formatter, TUI dumps raw `failureDetail` | — |
| `failed-publication-consumers-drop-completed-special-case` | **dispatchable** — unblocked by #4088/#4109 | — |
| `mutation-repair-commits-pushed-before-settlement` | **dispatchable** — chain D tail, unblocked by #4102; `settleMutationRepairExhausted` commits, never pushes | — |
| `repair-exhausted-error-names-site-and-killing-set` | `mutation_repair_exhausted` op spreads no site fields | previous row |
| `detach-admission-refuses-without-a-run-row` | **not dispatchable — rewrite first.** Its decisions ask `--detach` to refuse with no run id, which #4087 deliberately ruled out by persisting a real row. Rewrite to the persisted-row contract. Blocked twice on dispatch | a hand rewrite |
| `wal-lock-holder-child-survives-to-marker` | **evidence-gated (#4101).** Do not plan until an operator pastes a captured rejection into the file; plan PR #4100 was rejected for un-tickable criteria | a captured rejection |
| `workflow-terminal-waits-await-durable-boundary` | **premise false — retire.** `bunfig.toml` sets `[test] timeout = 30000` and `workflow.test.ts` has no `5000`; plan PR #4105 rejected. Superseded by seed `spawned-cli-tests-inherit-a-five-second-connect-bound` | — |
| `publication-failures-settle-failed-writer` | stale — spec landed #4088, unreaped | reap |
| `subprocess-marker-rejection-carries-cause` | stale — spec landed #4097, unreaped | reap |
| `declared-isolation-class-for-wall-clock-bounded-suites` | stale — spec landed #4098, unreaped | reap |

## Seeds (30)

P is the brief's priority. Issue is the intake issue where one exists.

| Seed | P | Issue | Status (2026-09-18 audit) |
| --- | --- | --- | --- |
| `stage-failure-record-drops-terminal-cause` | P0 | — | **new** (#4111) — regression from #4108: `stageFailedCause` reads `terminalCause` off an `OperatorFailureRecord` that lacks it; `run_timeout` degrades to `failed` |
| `spawned-cli-tests-inherit-a-five-second-connect-bound` | P1 | — | **new** (#4111) — `CONNECT_TIMEOUT_MS = 5_000` (`v2/src/ipc/client.ts:11`) bounds spawned-CLI tests; supersedes the retired `workflow-terminal-waits` premise |
| `capture-token-usage-on-failed-invocations` | P2 | — | open (#4080); usage fields live on `InvocationOk` only, so failed calls are unpriced |
| `pipeline-resume-resumes-a-resumable-implement-row` | P1 | — | open; widened #4016 (any resumable kind recovered by `run resume` orphans its stage); stray AC moved into section |
| `resume-surfaces-admission-gate-refusal` | P1 | — | open; preflight refusal text reaches only detached dispatch |
| `interrupted-pipeline-stage-cannot-be-resumed` | P1 | #2996 | **new** — carved from the closed settlement seed; `resumeDeferredRefusalApplies` still refuses `interrupted` |
| `stale-reset-destroys-commits-for-external-specs` | P1 | #3433 | rewritten: branch deletion closed by #4014; gate 2 still blind to external trees; tip SHA still missing |
| `implement-retirement-destroys-artifacts-before-materialization` | P1 | — | open; `--base <own-branch>` still destroys then fails; plan-side `validateExplicitPlanBase` is the pattern |
| `abandon-refuses-unlanded-work-with-no-pr` | P1 | — | open; `runAbandonCommand` gates only on open/ready PRs; `carriesNoUnlandedCommits` exists |
| `retention-tiers-for-session-logs-and-telemetry` | P1 | — | open; sequence after `cleanup-reaps-orphan-session-logs` (landed #4086) |
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

Issue #3029 (mechanisms 2 and 4 of the `## Blocker` contract) is the only one still needing work. #3423 (remainder landed #4090) and #3417 (remainder landed #4076) are done and should be closed. Closed: #3040 (#4085), #4004 (#4076), #3949, #3974, #3372.

## Reaped 2026-09-20

| Item | Reason |
| --- | --- |
| seed `wal-lock-holder-child-exits-silently` | consumed into ready-intent `wal-lock-holder-child-survives-to-marker` by #4092; rewritten evidence-gated by #4101 |
| seed `coscheduled-test-pair-strands-runs-terminally` | consumed into ready-intents `subprocess-marker-rejection-carries-cause` and `workflow-terminal-waits-await-durable-boundary` by #4093 |
| ready-intents `fence-derivation-failure-settles-honestly`, `report-gate-refusal-causes`, `cleanup-reaps-orphan-session-logs`, `explicit-reset-flag-names-continue-path`, `branch-resume-refusal-names-blocking-row`, `publication-failure-rows-migrate-failed` | reaped by their own implement PRs |
| ready-intent `linked-implement-routing-settles-a-real-outcome`, spec dir | landed #4087; archived and reaped by #4104 |
| plan PRs #4094, #4095 | closed as subsumed by implement PRs #4097, #4098 |
| plan PRs #4100, #4105 | rejected — un-tickable criteria (#4100) and a false premise (#4105) |

## Reaped 2026-09-19

| Item | Reason |
| --- | --- |
| seed `daemon-changeover-rebind-test-flakes-under-load` (#4049) | landed #4060 (+#4070, #4071); spec hand-archived in the 2026-09-19 closeout PR |
| seed `cli-json-output-truncated-at-pipe-buffer` (#4054) | landed #4058 |
| seed `rebased-lane-cannot-publish-on-non-force-push` | consumed by intent #4040; landed #4061 |
| seed `tests-leak-tmpdirs-and-slow-every-spawn` (PR #4064, closed) | fixed directly #4068 |
| ready-intents `gate-allowset-derivation-handles-external-and-empty-spec-scope`, `ready-gate-repair-fence-revert-and-settle`, `daemon-changeover-rebind-test-flakes-under-load` | landed but not reaped by their implement PRs; removed in the 2026-09-19 closeout PR |

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
| seeds `ready-gate-repair-out-of-diff-edits`, `render-observer-verification-keeps-a-fixed-deadline`, `implement-admission-persists-its-run-row`, `publication-failures-settle-failed`, `gate-allowset-derivation-fails-on-external-spec-home` | consumed into ready-intents by #4031, #4032, #4033, #4035, #4036, #4038 |
| ready-intent `single-spec-home-predicate` | landed #3916/#3917 (`specsHome`, `resolveSpecsHome`); residual is a two-line wrapper, not worth a lane |

## Landed 2026-09-20 (for tracing; details in `reports/`)

- P0 fixed points: #4085 ready-gate repair targets the failing step; #4087 no-row routing persists a real row; #4088 publication-tail failures settle `failed`; #4089 explicit reset flag names the continue path; #4090 fence-derivation failure is named and logged; #4109 legacy `completed` rows with a failure cause migrate to `failed`.
- Chains: #4091 chain B link 3 (report gate-refusal cause and retry state); #4096 and #4110 chain A links 2–3; #4108 chain C, all 5 subspecs; #4102 chain D killing-set 01.
- Cleanup and tests: #4086 orphan session logs reaped by mtime; #4097 `waitForStdoutMarker` rejections name exit code and stderr; #4098 declared isolation class for wall-clock-bounded suites.
- Harness and hygiene: #4099 importer discovery scans the `scripts` surface; #4104 archival of `linked-implement-routing`; #4111 two new seeds.
- Plans: #4081, #4082, #4083, #4084, #4103, #4106. Intents: #4092, #4093, #4101 (evidence gate).

## Landed 2026-09-16 → 2026-09-19 (for tracing; details in `reports/`)

- #4046 spec `stage-success-reopens-skipped-successors` (chain A head).
- #4048 spec `ready-gate-autofix-best-effort-on-unfixable-lint` (plan #4037 subsumed; hand-finished).
- #4056 spec `persist-gate-refusal-recovery-state` (chain B head); #4074 spec `redrive-slot-refused-gates` (chain B link 2, `slot_redrive` verified in production).
- #4058 spec `cli-flushes-stdout-before-exit` (plan #4057 subsumed).
- #4060 spec `daemon-changeover-rebind-test-flakes-under-load` (hand-finished); #4070 rebind admission race; #4071 bind-window determinism.
- #4061 spec `rebased-lane-publishes-with-lease`.
- #4063 spec `owning-daemon-writes-invocation-settled-marker`; #4072 spec `run-ad-hoc-terminal-derives-from-settled-marker`.
- #4065 spec `render-observer-verification-keeps-a-fixed-deadline`.
- #4067 terminal publication runs the real ready gate.
- #4068 tests remove every temp dir they create; #4069 verifier process groups reaped on owner signal.
- #4073 spec `ready-gate-repair-fence-revert-and-settle`.
- #4076 spec `gate-allowset-derivation-handles-external-and-empty-spec-scope`.
- Archival of the 9 spec dirs above: #4078.

`implement-pr-body-is-reviewer-facing` #3941/#3947/#3951; `test-suite-wall-clock` #3953/#3956/#3957/#3972; `pipeline-lane-ready-pr-notifies` #3970; telemetry caps #3937; `resume-failed-link-row-through-workflow` #3977/#3982; `run-admission-stamps-its-owner` #3981/#3987; `intent-landing-accepts-no-prerequisites` #3979/#3988; `artifact-count-exempts-references-and-rules-out-clauses` #3984; base-ref probe #3990/#3995; `daemon-retire-trigger-logging` #3994; `workflow-invocation-settled-marker-store` #4011; `mutation-verifier-skips-test-support-files` #4012; `decisions-ledger-prompt-requires-bullet-list` #4013; `redispatch-continues-committed-lane` #4014; `plan-draft-normalizer-bulletizes-decisions` #4017; `daemon-committed-successor-watch` #4022; `stage-settlement-foreign-owner-liveness` #4023; `recover-admits-landing-failed-plan-write-row` #4025; v1 prompt-artifact retirement #4028; standing-rules fragments + staged lint autofix #4029.
