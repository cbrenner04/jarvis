# Structural-recovery traceability ledger

Supplemental to [`structural-recovery-brief.md`](./structural-recovery-brief.md). One row per open item in `v2/spec/`: what it is, what it waits on, and the last evidence. Rebuilt 2026-09-18 from a source audit of every item; refreshed 2026-10-01 against `main` @ `6e2255e05`; session narratives live in `reports/`, not here. Line numbers inside seeds drift; treat them as pointers and verify against `main` before planning. When an item lands, delete its row and add one line under § Reaped or § Landed with the PR; no journal paragraphs.

## Open specs (1)

| Spec | Plan PR | Subspecs | Status |
| --- | --- | --- | --- |
| `20260930T223106Z-review-feedback-item-traceability` | #4298 | — | implement PR #4303 open, reviewed; 2 green CI pending; merge next session |

Every other landed spec is archived under `completed/`.

## Ready-intents (4 queued: 3 dispatchable, 1 not startable)

| Ready-intent | Status | Blocked on |
| --- | --- | --- |
| `agent-bindings-recover-usage-on-failed-settlement` | dispatchable (standalone plan) | — (#4301 landed its prerequisite) |
| `publication-inflow-mutation-repair` | dispatchable; replan from the ready-intent (plan PR #4284 closed) and carry its reviewed decisions: re-verify HEAD before repair, revert weakened killing tests, revert uncommitted repair edits on timeout | — |
| `retire-superseded-pipeline-branches` | dispatchable | — (#4290, #4296 landed) |
| `wal-lock-holder-child-survives-to-marker` | **evidence-gated (#4101)** | a captured rejection |

## Seeds (22)

P is the brief's priority. Issue is the intake issue where one exists.

| Seed | P | Issue | Status (2026-09-18 audit) |
| --- | --- | --- | --- |
| `agent-abort-reaps-its-process-tree` | P1 | — | new 2026-10-01; cursor shell-tool sessions escape agent group kill: `bun test` pid 55854 at 97% CPU 45 min after cd5e5790 iteration_timeout, ppid 1; load ~31 |
| `plan-draft-shape-names-its-failure` | P1 | — | new 2026-10-01; pipeline 62810cc3 plan lane stranded on bare `plan.draft.shape` (nested spec dir); hand-flattened + recover |
| `harness-commits-stay-in-run-scope` | P1 | — | new 2026-10-01; 3 lanes swept out-of-scope content on 2026-09-30 (d39f5071c, bf1e5cbc6, 658c18963) |
| `terminal-publication-accepts-operator-merged-pr` | P1 | — | new 2026-10-01; pipelines 998a665f, 66f666ad + once prior session |
| `closed-lane-is-not-republished` | P1 | — | new 2026-10-01; #4302 republished closed #4286; prior #4243/#4244 |
| `tui-revision-follow-replaces-itself` | P2 | — | new 2026-10-01; 19-process TUI chain on ttys001 |
| `implement-respects-target-repo-doc-layout` | P2 | #3426 | open; leak 3 closed by #4029; `intent-split.test.ts` pins leak 1 |
| `intent-split-covers-sibling-repo-surfaces` | P2 | #3439 | re-scoped to split-internal prerequisite consistency (`siblings` was v1-only) |
| `detached-pipeline-plan-stage-consumes-ready-intents` | P2 | #3041 | AC2 landed #3534, AC3 landed #3657; in-repo git-chained silent skip remains; chosen mechanism over the retired merge-at-gate seed |
| `per-project-config-overrides-seam` | P2 | #3026, #3150 | open; `agents` / `idleOutputTimeoutMs` machine-level only |
| `implement-can-run-integration-slice-tests` | P2 | — | re-scoped to measurement criteria after #3867 |
| `self-parsing-structural-tests-can-bind-to-their-own-fixtures` | P2 | — | open; scope corrected to one file |
| `pipeline-fan-out-per-lane-terminal-settlement` | P2 | — | ready-flip half served by #3970; per-lane `merge` + spurious `failed` remain; doc target moved to `pipeline-execution.md` |
| `pipeline-fan-out-lanes-serial-chained-bases` | P2 | — | open; prerequisite (per-lane settlement) not landed |
| `agent-confinement-is-per-vendor-and-unexpressed` | P3 | #1453 | open; depends on `per-project-config-overrides-seam` |
| `cli-retire-run-start-pause-and-config` | P3 | — | open decision on `run pause` (see brief) |
| `tui-dock-command-grammar-mirrors-cli` | P3 | — | open; land with or after `tui-typed-run-steering-clears-command-input` |
| `tui-typed-run-steering-clears-command-input` | P3 | — | open; `runSteeringAction(method); return;` still no clear |
| `pipeline-stage-addresses-review-feedback` | P1 | — | new 2026-09-30; `pipeline resume --address-review <stage>`; after the review-feedback preset chain lands |
| `harness-exposes-agent-toolset` | — | — | new 2026-09-29; **not dispatchable until owner sign-off** (near a new engine generation) |
| `fold-shared-into-v2` | P3 | — | new 2026-09-29; prerequisite of `retire-v2-nomenclature` |
| `retire-v2-nomenclature` | P3 | — | new 2026-09-29; `v2/` → top level; after `fold-shared-into-v2`; fold in at low priority |

## Open intake issues without a seed

None; #3029 closed 2026-09-30. Closed: #3423 (#4090), #3417 (#4076), #3040 (#4085), #4004 (#4076), #3949, #3974, #3372.

## Reaped 2026-10-01

| Item | Reason |
| --- | --- |
| ready-intent `detach-admission-refuses-without-a-run-row` | already closed by #4087 (routing row persisted before its id is reported); deleted, not rewritten |
| seeds `capture-token-usage-on-failed-invocations`, `review-roles-check-falsifiability-not-plausibility`, `mutation-verifier-ignores-whitespace-only-line-changes`, `completed-write-step-rows-stamp-finished-at`, `cleanup-retires-subsumed-and-landed-worktrees`, `superseded-pipeline-pr-hygiene` | consumed by intents #4247 #4248 #4251 #4256 #4257 #4274 #4275 #4276 #4277 |
| 14 ready-intents (`backfill-terminal-null-finished-at-migration`, `cleanup-retires-subsumed-and-landed-worktrees`, `completion-boundary-terminal-stamps-finished-at`, `configure-pipeline-supersede-policy`, `invocation-completed-records-failure-usage`, `mutation-reprompt-colocated-fix-line`, `mutation-verifier-ignores-whitespace-only-line-changes`, `pipeline-verbs-accept-full-ids-on-degraded-listing`, `plan-stage-bases-on-fetched-default-branch`, `review-roles-falsifiability-implement`, `review-roles-falsifiability-plan`, `settle-superseded-pipeline-prs`, `shrink-post-mutation-reverify`, `skipped-durable-successor-rollup-completed`) | landed or consumed; not reaped by their implement PRs (some reintroduced by merged intent/plan PRs) |
| landed spec dirs | archived (closeout 2026-09-30b) |
| PRs #4286, #4302 | closed: #4286 swept stale-`main` content (rebuilt as #4301); #4302 duplicate republication of the closed lane |

## Reaped 2026-09-30 (second session)

| Item | Reason |
| --- | --- |
| seed `serial-rerun-includes-frozen-v1` | intent #4249 fanned out a strict 3-lane chain; rejected and hand-assembled into ready-intent `live-serial-test-confirmation` |
| issue #3029 | closed: mechanisms 2 and 4 fixed by #3670 and #3734; stale runbook note removed |
| ready-intents `capture-pr-review-input`, `configure-session-log-retention-tiers`, `handoff-rollback-restores-admission-after-handoff-supersede`, `non-pipeline-preset`, `republication-redrafts-harness-ready-pr`, `retiring-sole-daemon-self-heals-admission`, `terminal-publication-records-ready-flip` | landed #4208 #4188 #4203 #4209 #4233 #4227 #4231; not reaped by their implement PRs |
| spec dirs `repair-exhausted-…`, `pipeline-resume-resumes-…`, `pipeline-resume-preflights-…`, `run-resume-claims-…`, `non-terminating-mutation-…`, `review-feedback-lane-admission` | archived by cleanup (landed #4180 #4186 #4190 #4216/#4236 #4191 #4234) |
| pipelines c1d2db5f, 96f57442, f13b29a3, bb738352 | stale gates rejected, dismissed; remaining lanes re-dispatched standalone |
| issue #4003 | closed: #4168 #4237 |

## Reaped 2026-09-30

Ledger stated 31 seeds with 31 rows, but 9 rows named seeds already consumed by intents (only 22 on disk); removed.

| Item | Reason |
| --- | --- |
| seeds `run-resume-refused-while-draining-generation-owns-terminal-row`, `non-terminating-mutation-settlement-names-its-site`, `cursor-quota-classified-from-stream-json-content`, `failed-self-handoff-leaves-daemon-refusing-work`, `apply-pr-review-feedback-to-a-lane`, `pipeline-decision-claim-misses-older-draining-generation`, `pipeline-stage-redispatch-rebases-onto-moved-base`, `republication-refuses-pr-the-lane-flipped-ready`, `reopened-implement-rolls-up-killed-without-review-row` | consumed by intents #4178 #4181 #4184 #4196 #4204 #4212 #4218 #4226 #4238 |

## Reaped 2026-09-29

| Item | Reason |
| --- | --- |
| seed `stale-reset-destroys-commits-for-external-specs` → ready-intents `stale-reset-compares-specs-at-read-root`, `workflow-preflight-routes-external-spec-trees` | by design: no loss path out-of-root (plan blocker); pipeline e0128f15 rejected; closes #3433 |
| ready-intents `run-resume-returns-admission-refusal`, `run-projection-names-resume-refusal`, `tui-surfaces-resume-refusal` | false premise: `run resume` never reaches the stale-reset gates; plan c5f09414 blocked on it |

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

## Landed 2026-09-30 (second session; details in `reports/`)

- Implements: #4260 #4263 #4264 #4266 #4267 #4268 #4278 #4282 #4287 #4290 #4292 #4293 #4294 #4295 #4296 #4297 #4300 #4301.
- Direct fixes: #4265 #4271 #4291 #4299.
- Plans: #4250 #4253 #4288 #4289 #4298. Seeds: #4252 #4270.

## Landed 2026-09-29 → 2026-09-30 (for tracing; details in `reports/`)

- Seeds landed: run-resume-refused #4216/#4236; non-terminating site #4191; cursor quota #4197; failed self-handoff #4200 #4203 #4227 #4242; decision claim #4220; re-dispatch onto moved base #4224; republication of harness-ready PR #4229 #4231 #4233.
- Partial: `apply-pr-review-feedback-to-a-lane` #4208 #4209 (#4234 open; pipeline 96f57442); `reopened-implement-rolls-up-killed-without-review-row` plan #4240 (pipeline c1d2db5f open).
- Ready-intents: #4180 repair-exhausted site; #4186 resume resumable implement row; #4168 #4237 node_modules link; #4173 #4188 #4223 session-log retention (telemetry lane f13b29a3 open).
- Direct fixes: #4174 #4185 #4194 #4211 #4214 #4235 #4239.

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
