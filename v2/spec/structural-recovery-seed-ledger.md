# Structural-recovery traceability ledger

Supplemental to [`structural-recovery-brief.md`](./structural-recovery-brief.md). One row per open item in `v2/spec/`: what it is, what it waits on, and the last evidence. Rebuilt 2026-09-18 from a source audit of every item; refreshed 2026-09-21 against `main` @ `a076cafff`; session narratives live in `reports/`, not here. Line numbers inside seeds drift; treat them as pointers and verify against `main` before planning. When an item lands, delete its row and add one line under § Reaped or § Landed with the PR; no journal paragraphs.

## Open specs (1)

| Spec | Plan PR | Subspecs | Status |
| --- | --- | --- | --- |
| `20260911T154954Z-tui-consumes-retained-pipeline-list` | #3791 | 0/2 | Pinning spec, valid |

Every other landed spec is archived under `completed/`.

## Ready-intents (8 queued: 4 dispatchable, 4 not startable)

| Ready-intent | Status | Blocked on |
| --- | --- | --- |
| `repair-exhausted-error-names-site-and-killing-set` | **dispatchable** — chain D tail, unblocked by #4138; op spreads no site fields | — |
| `pipeline-resume-resumes-resumable-implement-row` | **dispatchable** — unblocked by #4149 | — |
| `run-resume-returns-admission-refusal` | **dispatchable** — resume-surfaces head (#4139) | — |
| `run-projection-names-resume-refusal` | queued | `run-resume-returns-admission-refusal` |
| `pipeline-resume-preflights-dispatch-refusals` | **dispatchable** — resume-surfaces head (#4139) | — |
| `tui-surfaces-resume-refusal` | queued | `pipeline-resume-preflights-dispatch-refusals` |
| `detach-admission-refuses-without-a-run-row` | **not dispatchable — rewrite first.** Its decisions ask `--detach` to refuse with no run id, which #4087 deliberately ruled out by persisting a real row. Rewrite to the persisted-row contract. Blocked twice on dispatch | a hand rewrite |
| `wal-lock-holder-child-survives-to-marker` | **evidence-gated (#4101).** Do not plan until an operator pastes a captured rejection into the file; plan PR #4100 was rejected for un-tickable criteria | a captured rejection |

## Seeds (22)

P is the brief's priority. Issue is the intake issue where one exists.

| Seed | P | Issue | Status (2026-09-18 audit) |
| --- | --- | --- | --- |
| `capture-token-usage-on-failed-invocations` | P2 | — | open (#4080); usage fields live on `InvocationOk` only, so failed calls are unpriced |
| `stale-reset-destroys-commits-for-external-specs` | P1 | #3433 | rewritten: branch deletion closed by #4014; gate 2 still blind to external trees; tip SHA still missing |
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
| `non-terminating-mutation-settlement-names-its-site` | P2 | — | open; one missing spread in `publicationLoopFinishedBase`; sequence after `repair-exhausted-error-names-site-and-killing-set` |
| `superseded-pipeline-pr-hygiene` | P2 | — | unblocked by #3745; absorbs stacked-PR cleanup from the retired merge-at-gate seed |
| `pipeline-fan-out-per-lane-terminal-settlement` | P2 | — | ready-flip half served by #3970; per-lane `merge` + spurious `failed` remain; doc target moved to `pipeline-execution.md` |
| `pipeline-fan-out-lanes-serial-chained-bases` | P2 | — | open; prerequisite (per-lane settlement) not landed |
| `agent-confinement-is-per-vendor-and-unexpressed` | P3 | #1453 | open; depends on `per-project-config-overrides-seam` |
| `cli-retire-run-start-pause-and-config` | P3 | — | open decision on `run pause` (see brief) |
| `tui-dock-command-grammar-mirrors-cli` | P3 | — | open; land with or after `tui-typed-run-steering-clears-command-input` |
| `tui-typed-run-steering-clears-command-input` | P3 | — | open; `runSteeringAction(method); return;` still no clear |

## Open intake issues without a seed

Issue #3029 (mechanisms 2 and 4 of the `## Blocker` contract) is the only one still needing work. Closed: #3423 (#4090), #3417 (#4076), #3040 (#4085), #4004 (#4076), #3949, #3974, #3372.

## Reaped 2026-09-21

| Item | Reason |
| --- | --- |
| seeds `stage-failure-record-drops-terminal-cause`, `spawned-cli-tests-inherit-a-five-second-connect-bound`, `daemon-status-reports-stopped-on-a-busy-daemon`, `implement-retirement-destroys-artifacts-before-materialization`, `abandon-refuses-unlanded-work-with-no-pr`, `interrupted-pipeline-stage-cannot-be-resumed`, `pipeline-resume-resumes-a-resumable-implement-row`, `resume-surfaces-admission-gate-refusal` | consumed by intents #4120 #4121 #4122 #4129 #4130 #4131 #4137 #4139 |
| ready-intent `workflow-terminal-waits-await-durable-boundary` | false premise; retired #4119 |
| plan PRs #4124, #4125, #4128, #4133, #4134, #4150 | closed as subsumed |

## Reaped 2026-09-20

| Item | Reason |
| --- | --- |
| seed `wal-lock-holder-child-exits-silently` | consumed into ready-intent `wal-lock-holder-child-survives-to-marker` by #4092; rewritten evidence-gated by #4101 |
| seed `coscheduled-test-pair-strands-runs-terminally` | consumed into ready-intents `subprocess-marker-rejection-carries-cause` and `workflow-terminal-waits-await-durable-boundary` by #4093 |
| ready-intents `fence-derivation-failure-settles-honestly`, `report-gate-refusal-causes`, `cleanup-reaps-orphan-session-logs`, `explicit-reset-flag-names-continue-path`, `branch-resume-refusal-names-blocking-row`, `publication-failure-rows-migrate-failed` | reaped by their own implement PRs |
| ready-intent `linked-implement-routing-settles-a-real-outcome`, spec dir | landed #4087; archived and reaped by #4104 |
| plan PRs #4094, #4095 | closed as subsumed by implement PRs #4097, #4098 |
| ready-intent `workflow-terminal-waits-await-durable-boundary` | false premise; superseded by seed `spawned-cli-tests-inherit-a-five-second-connect-bound` |
| spec `bulk-terminal-run-dismissal-cli` | landed #4112; archived #4118 |
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

## Landed 2026-09-21 (for tracing; details in `reports/`)

- P0: #4132 linked-stage timeout incident cause from durable runs.
- Tails: #4151 chain C `render-operator-failures-consistently`; #4145 publication `failed-publication-consumers-drop-completed-special-case`; #4138 chain D `mutation-repair-commits-pushed-before-settlement`.
- IPC and daemon: #4136 connect-bound policy and diagnostic; #4152 spawned workflow CLI connect bound; #4143 `daemon status` preserves inconclusive liveness; #4153 decision verbs claim from any draining generation (seed #4146).
- Retirement: #4140 implement retirement validates before destroying; #4147 `cleanup --abandon` refuses unlanded work with no PR.
- Resume: #4149 failed implement stage settles from its recovered write row; #4154 operator-killed pipeline stages resumable (#2996; no auto-continue).
- Direct fix: #4142 intent stage discards agent vendor dirs before validation.
- Plans: #4123, #4126, #4127, #4135, #4141, #4144. Intents: #4120, #4121, #4122, #4129, #4130, #4131, #4137, #4139, #4148.

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
