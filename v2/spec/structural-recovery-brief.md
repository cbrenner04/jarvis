# Structural recovery brief

Successor to `pipeline-attribution-and-hygiene-brief.md` (retired in this rewrite; every open row is carried below or lives in `seeds/`). Sourced from the 2026-08-29 code review of `v2/src` (four fan-out audits: dispatch seams, cruft, fix-commit taxonomy, CLI surface). This doc is the phase tracker: tick as work lands.

Per-seed completion status (seed → ready-intent → plan → implement PR) lives in the companion [`structural-recovery-seed-ledger.md`](./structural-recovery-seed-ledger.md).

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

- **PR #3060 — MERGED 2026-08-29.** Dispatch-parity spec complete (subspecs 00–02): pipeline dispatch stamps the full step-config layer, watchdogs arm on daemon write steps, resume reads write-sibling stamped commands. The readyCommand cascade (#2976→#3060, five fixes) is closed; its seed is reaped. The test-file hang's true cause was stub steps without `worktree` (the stamp threw before `wait()`, starving microtask spin loops) — not timers; the watchdog unrefs landed as hygiene, leaving [[watchdog-timers-never-hold-the-event-loop]] as a pin-test seed. The spec dir awaits the next `jarvis cleanup` archival pass.
- **Spec `20260829T023500Z-deferred-settlement-resume-preserves-pr-evidence` — MERGED 2026-08-29** (subspec 00 #3054, subspec 01 #3069). Point fix for the sharpest dogfood blocker; later subsumed by [[pipeline-settlement-derives-from-run-rows]] (which retires the deferred-settlement machinery it patches). Its seed is reaped. Subspec 01's publication surfaced a new blocker — ready-flip on a prior subspec's closed same-branch PR — seeded as [[implement-publication-reuses-closed-same-branch-pr]] and hand-published as #3069.

## Session progress (2026-08-29 PM)

- **P1-small + P1-restructure seeds run through `intent` → ready-intents on `main`:** [[daemon-resume-honors-injected-config-path]] (#3063), [[pipeline-architecture-doc]] (#3064), [[unify-git-status-parsing]] (#3065), [[harness-publication-push-uses-explicit-refspec]] (#3072), [[plan-review-failure-preserves-and-recovers-the-good-draft]] (#3073), [[terminal-state-honesty-invariant]] (#3074), [[pipeline-settlement-derives-from-run-rows]] (#3075), [[pipeline-dispatch-shares-cli-front-door]] (#3076), [[implement-boundary-commit-failure-strands-authored-work]] (#3077), [[retire-mutation-checkpoint-dsl]] (#3078). Each restructure decomposed into a coupled ready-intent chain — plan in dependency order, foundational slice first.
- **Plans landed as specs:** [[pipeline-architecture-doc]] spec (#3066); lossless-git-status helper (unify subspec 00) spec (#3068). Retire-mutation lead (`retire-plan-mutation-checkpoint-authoring`) plan in flight.
- **Implements:** deferred-settlement P0 fully merged. Lossless-helper implement is the current bottleneck — crashed the machine once (concurrent local suite load), then a 45-min codex iteration timeout; re-running, hand-implement fallback.
- **Parked/closed:** daemon-resume plan #3067 closed (see the P3 demotion below).
- **Load/churn finding:** intents/plans parallelize cheaply (7+1 concurrent ≈ load 4/18, 94% mem free); the crash lever is concurrent *local suite invocations* — each `bun test` spawns ~20 workers (`--max-concurrency=20`), and an implement gate on `shared/**` runs three suites. Discipline: never run manual `bun test`/`check` beside a live gate; keep implements ~1 at a time. No global concurrency cap across gates — seed candidate if it recurs. The implement stage (serial; codex-first times out on fiddly work) is the throughput ceiling, not intent/plan generation.

## Session progress (2026-08-29 evening)

- **Mutation-verifier cost fix — the session's unblock.** [[mutation-verifier-per-mutation-suite-cost]] seed (#3084) → intent (#3092) → plan (#3093) → implement salvaged (#3098). Diff-derived ready-finalization verification now scopes each candidate to its co-located killing test + caps `bun test` concurrency, so `shared/**`-scope implements stop exhausting the post-write budget. Root cause of the earlier "codex can't implement" timeouts: **codex wrote correct code; the per-candidate full-suite-union re-run blew the 45-min ceiling.** Validated — every later shared-scope implement completed clean.
- **Retire-mutation-checkpoint-dsl — 3 of 4 slices merged:** plan-authoring (#3086), implement-verification (#3099), checkpoint-resume-replay (#3101). Log-events planned (#3102, spec on `main`); its implement completes the chain (needs a daemon bounce first so #3101 is live).
- **Unify-git-status:** lossless helper implemented (#3083, salvaged codex's correct-but-uncommitted work); execution consumers 00-01 (#3087). **Consumer 02 (dirty-worktree under-report) left partial — resume it;** cleanup-consumer plan blocks until 02 lands.
- **Restructure foundations:** terminal-honesty atomic-store spec (#3096, *unimplemented*); implement-boundary-commit record-commit-cause (#3100); plan-review-failure recover-plan-draft (#3103, needed a cognitive-complexity refactor to pass biome). Architecture-doc spec (#3066) still *unimplemented*. Prompt-corpus: split-spec-guidance intent → 2 ready-intents (#3094).
- **Main went silently biome-RED, fixed (#3104).** CI *does* gate `bun biome check`; #3098/#3099's checkpoint deletions left unused imports that each individually-green PR didn't trip but **accumulated on `main`** → CI-red for every new PR. A parallel-merge combination hazard. Lesson: read the actual biome error category — complexity/unused-import/format all fail `check`, not just the harmless `noNonNullAssertion` warnings.
- **New seeds:** [[implement-completes-without-publishing]] (#3088 — standalone implement completes write+review but never pushes/opens a PR, no error; **every implement this session was hand-published**); [[mutation-verifier-per-mutation-suite-cost]] (#3084).
- **Load ceiling characterized:** implements cap at ~2 concurrent (hit 18/18 saturation at three, backed off); **never run local suites beside a live implement** — a resume-replay v2 run showed 122 false SQLite `disk I/O`/`database is locked` failures purely from contention, clean on isolated re-run. Publication strand + serial hand-publish (not machine capacity) is the implement-throughput ceiling.

## Session notes (2026-08-30 bug-fix standby)

Intake-driven session (issues #3106, #3119, #3122); all fixes landed through the normal chain. Overlap with this brief:

- **The git-disabled/external family is the dispatch-parity class live.** #3106 → codex `--skip-git-repo-check` + advancing refusal classification (#3112), stderr persistence (#3113) + `error.message` projection (#3117). #3119 → shared `projectSafeId` (#3125) + chained-stage matcher covers `intent-work/`/`specs/` roots (#3128). The matcher fix is a point patch on the seam [[pipeline-dispatch-shares-cli-front-door]] retires — its tests are behavior pins the front-door work inherits; `selectChainedStageCwd` handing the prior workspace path to stage builders is the mechanism to retire, not extend.
- **External-capability sequencing:** [[implement-admits-externally-landed-specs]] (#3122) and [[all-spec-documents-external-capable]] (operator ask; history: external-only was never the default — #120 covered config/worktrees, external home opt-in since #63/#64) are seeded but **deliberately not started**. Sequence both after [[pipeline-dispatch-shares-cli-front-door]] (front-door plans should treat external homes as a first-class resolution case) and coordinate the archival slice with [[cleanup-uses-lossless-git-status]].
- **[[terminal-state-honesty-invariant]] carries a new field:** #3113 added `InvocationFailureDetail.message` (bounded final-attempt stderr) written at settlement; the atomic-store implementer must preserve it.
- **[[implement-completes-without-publishing]] counter-evidence:** all four standalone implements this session (#3112, #3113, #3117, #3128) auto-published and ready-flipped. Verify-or-reap.
- **[[plan-draft-contract-miss-reprompts-before-blocking]] (#3114, new seed) held** pending [[split-spec-guidance-agent-core]] / [[plan-draft-rules-single-source]] — three multi-surface-AC contract misses in one session may be a prompt-layer fix, not a new reprompt loop (the retire-mutation direction argues against adding reprompt arms).
- **[[retire-checkpoint-log-events]] prerequisite satisfied:** the daemon has bounced many times since #3101; its implement (`20260829T192533Z` spec on `main`) is runnable now.

## Session progress (2026-08-30 continuation — 19 PRs)

- **Retire-mutation-checkpoint-dsl chain COMPLETE (4/4):** [[retire-checkpoint-log-events]] implement landed (#3133). Class closed.
- **Terminal-state-honesty chain advancing:** atomic-store primitive `commitTerminalRunSettlement` (#3134) → daemon consumer [[daemon-terminal-run-settlement]] (plan #3140, implement #3145) → execution consumer [[execution-terminal-run-settlement-invariant]] (plan #3149, **implement 00 landed #3157; 01/02 deferred**). One atomic terminal-write owner is now real for the daemon side; the write-loop/workflow-runner side is subspec-00-deep.
- **Front-door chain advancing:** [[pipeline-dispatch-shares-cli-front-door]] → shared prep API [[share-workflow-start-preparation]] (plan #3141, implement #3143) → [[require-complete-pipeline-context]] (plan #3148, implement #3155). `prepareWorkflowStart` is the shared owner; pipeline context is now schema-checked + fail-closed. `dispatch-pipeline-stages-through-shared-preparation` is next.
- **Also landed:** [[pipeline-architecture-doc]] `pipeline-execution.md` (#3137); lossless-git-status execution consumers 01+02 (#3138); [[codex-zero-exit-auth-failure-advances-agent-order]] (#3139, closed issue #3027); the seed ledger (#3144) reworked to one-row-per-ready-intent with PR links (#3147).
- **Attribution correction (important):** codex/`gpt-5.6-sol` was **quota'd the entire session** (2–4s quota exits); **cursor/Composer 2.5 was the actual actuator** for every plan and implement. The "codex-first tax" is really **cursor's contract-adherence**: multi-surface-AC/orphan-file plan-drafts (~7 blocked plan runs, all hand-landed), biome complexity/non-null on every implement commit, and mutation-coverage gaps. Reordering off codex is a no-op (cursor is already de-facto first); the levers are the plan prompt and cursor-vs-claude.
- **Plan prompt hardened by hand (#3154):** added one-surface-per-AC-bullet + index-links-every-subspec-file rules to `prompts/plan/draft.md` (rev 15) — the prevent-it-up-front lever the brief already favored over the [[plan-draft-contract-miss-reprompts-before-blocking]] reprompt loop (which stays held/skeptical).
- **Idle watchdog:** machine-wide `idleOutputTimeoutMs` raised to 900000 (15 min) — note this is read from `~/.jarvis/config.json` (`MACHINE_CONFIG_PATH`), NOT `config/machines/home.json` (whose `idleOutputTimeoutMs` is dead); runbook wording is misleading here. Durable fixes seeded: [[idle-watchdog-counts-worktree-filesystem-activity]] (#3153), plus intake seeds below.
- **Intake (chess-dogfood, run `0364af43`):** issues #3150/#3151/#3152/#3156 seeded — [[stall-settlement-preserves-agent-stdout]], [[idle-output-timeout-preserves-committed-progress-resumable]], [[plan-draft-shape-accepts-nested-stage-layout]]; #3150's core is #3153, its per-project-`idleOutputTimeoutMs`-override half remains (pairs with #3026 per-project-config). New mutation-verifier seed [[mutation-verifier-masks-type-generic-brackets]] (#3146) — verifier flips type-generic `<`/`>`, stranded #3143.
- **execinv 00 coverage debt:** #3157 landed correctness-SOUND but with partial mutation coverage (the harness stranded before its verifier ran) and a stale AC7 `@mutate` checkpoint — several new terminalCause/detail guards (main-loop boundary, repair-iteration blocked, non-gate readyFailed kinds, commit-failed/timeout tails, the run-operator-error.ts consumer) lack killing tests. Address in the 01/02 follow-up run.
- **Operational lessons:** (1) heavy in-session merging (19 PRs) churns the source digest and, with piecemeal hand-bounces, spawns **multiple orphaned `daemon-entrypoint` processes** — bounce once at a genuine idle point, sweep for strays. (2) The daemon is **shared across all registered projects** — a project-scoped "no live runs" check is not proof of an orphan; killing daemons on that basis ended a live chess workflow. (3) Leaked cursor-agent + `bun test` children survive settled runs and burn CPU for hours.

## Priority-ordered work

| P | Item | Delivers |
| --- | --- | --- |
| **P0 — gates first** | ~~[[plan-draft-shape-accepts-nested-stage-layout]] (#3156)~~ **DONE #3212** (closes issue #3156); [[plan-draft-contract-miss-reprompts-before-blocking]] (#3114) still open (held/skeptical) | Plan-draft shape now accepts flat or one nested `spec/<name>/` tree, flattening before normalization. Strictness/multi-surface-AC half (#3114) remains |
| **P0 — gates first** | ~~mutation-gate plan (4-seed)~~ **COMPLETE 4/4:** escape-hatch #3188, in-loop verification #3197, scanner-based #3202, importer-killing #3195. Plus verifier-crash containment #3211 (spec #3209). | Was the dominant implement-strand blocker; now crashes recoverably, false-flags less, strands resumably. Root-cause guard-flip slice fix ([[guard-flip-derivation-crash-is-contained]]) remains as follow-up |
| **P0 — gates first** | watchdog trio — **2/3 DONE:** #3152 (checkpoint #3189 + resume-admission #3194), #3153/#3150-core (#3218). Remaining: [[stall-settlement-preserves-agent-stdout]] (#3151) | Idle/stall watchdogs discard committed progress and misjudge live agents. Silent-edit false-kill and committed-progress resumability fixed; **#3151 is the last slice before relaxing serial-only implement** |
| **P0** | ~~Land #3060 + the deferred-settlement spec~~ (both merged 2026-08-29) | Watchdogs arm on pipeline runs; configured ready/fix commands honored ✓; review-bearing pipelines stop stranding their PR ✓ |
| **P0** | [[pipeline-architecture-doc]] | Cheap; states the target the P1 restructures converge on |
| **P1** | [[pipeline-dispatch-shares-cli-front-door]] | Retires the remaining dispatch-assembly copies (posture, review passes, stale-reset, admission, context source) |
| **P1** | [[pipeline-settlement-derives-from-run-rows]] | Retires copy-then-redrive settlement, both claim mechanisms, the dual `derivePipelineState`; absorbs [[operator-killed-pipeline-stage-is-recoverable]] and [[restart-reconciliation-preserves-paused-resumable-runs]] planning |
| **P1** | [[terminal-state-honesty-invariant]] | One atomic terminal-write owner; closes the 48-fix honesty class |
| **P1** | [[retire-mutation-checkpoint-dsl]] | Retires the checkpoint DSL layer (plan authoring mandate, `@mutate` directives, checkpoint verifier, the three reprompt loops); diff-derived verification stays the sole mutation gate. Attacks the 26-fix mutation/plan-contract churn class directly (operator ask, 2026-08-29). Decomposed into retire-{plan-authoring,implement-verification,checkpoint-resume-replay,checkpoint-log-events}. **3 of 4 merged (#3086, #3099, #3101); log-events planned (#3102), implement pending.** |
| **P1** (small, any time) | [[unify-git-status-parsing]], [[implement-boundary-commit-failure-strands-authored-work]], [[harness-publication-push-uses-explicit-refspec]], [[plan-review-failure-preserves-and-recovers-the-good-draft]] | Live bugs with evidence; independent of the restructures |
| **P3** (demoted) | [[daemon-resume-honors-injected-config-path]] | **Re-scoped 2026-08-29:** not a 1-line fix. The resume ceiling read (`daemon.ts:671`) runs in the *detached daemon* process, where the injected `machineConfigPath` is never set (the wrapper only runs at `cli.ts:48`), so honoring a scoped config needs config-path propagation *into* the daemon — a bigger change. Marginal in single-operator use (daemon reads the real `~/.jarvis/config.json`). Plan #3067 correctly caught the mechanism but carried a sandbox-unrunnable keystone AC; closed. Re-plan tightly only if scoped-daemon config injection becomes real |
| **P2→P1-ish** (unblocked, actively blocking) | [[implement-admits-externally-landed-specs]] → [[all-spec-documents-external-capable]] | `plan.commit: false` projects ride v2 end to end (#3122; operator ask). **Prerequisites landed** (`projectSafeId`, #3119 chained-stage matcher #3128; cleanup-lossless #3205); front-door ~3/4 done so its sequencing is soft. **Actively blocks the operator's homestead `full-review` pipeline** (implement stages can't run) — practical priority raised. Not started (operator paused new work 2026-08-31) |
| **P2** | [[split-workflow-runner-resume-machines]] | 5,141-line file split; twin resume machines merged (`resumable: true` bug); absorbs issue #2181 and the demoted load-isolation trio |
| **P2** | [[split-daemon-run-control-handlers]] | 1,318-line closure split; WeakMap back-channel and production test seams retired; guard generalized |
| **P2** | [[dead-export-and-test-seam-gates]] | knip-style gate; 6 dead exports; repair-fence bypass out of production |
| **P2** | [[typed-step-stubs-and-bounded-spins]] | Shared typed step factory + bounded-spin helper; retires the two scaffolding hazards behind the #3060 silent hang |
| **P2** | [[cli-retire-write-and-legacy-aliases]] → [[cli-retire-run-start-pause-and-config]] | CLI trim, sequenced (pause plumbing before `run start`); dismiss pairs merged |
| **P3** | [[mechanical-cruft-pass]] | Shared helpers, path derivations, dead flag, migration squash |
| **P3** | Re-triage demoted seeds | rename-lane family and supersede family re-scope against the post-settlement seam; load trio verify-or-reap |

Chess-dogfood seeds ([[per-project-agent-fallback-order]], [[codex-zero-exit-auth-failure-advances-agent-order]], [[blocker-contract-credits-existing-section]]) and display/TUI seeds ([[pipeline-list-display-retention]], [[tui-dock-command-grammar-mirrors-cli]], [[tui-typed-run-steering-clears-command-input]], [[full-light-review-pipeline]], [[cleanup-improvements]], [[ready-gate-repair-out-of-diff-edits]], [[implement-retirement-destroys-artifacts-before-materialization]], [[implement-resumes-stalled-unmerged-subspec-chain]]) keep their prior priorities; schedule them between restructure landings.

**Gate-fix P0 (2026-08-30, refactor-owner ask).** The last ~12h show the gates rejecting good work is now the dominant cost: 5/5 plans contract-miss-blocked (→ #3165 hand-land), 3 implements stranded at the mutation gate, #3164/#3166/#3169 closed unlanded on an equivalent mutation. These gates tax every subsequent run, and the P2 refactor seeds pay that tax on each of their runs — so gate fixes land first, ahead of every remaining P2 refactor seed.

## Operating notes

**Circuit-breaker (per-lane, per-gate).** If a lane (plan / implement / review) needs hand-intervention twice in a row on the same gate, stop routing that lane through Jarvis until the gate fix merges — hand-land the work instead. Re-open the lane only after one clean end-to-end run on the fixed gate. Mirrored in [operator-runbook.md § Circuit-breaker](../docs/operator-runbook.md#circuit-breaker-stop-routing-a-lane-that-keeps-failing-the-same-gate).

**Serial-only implement is under review (nearly relaxable).** The 2026-08-30 parallelization experiment ran two concurrent implements ~40 min with zero idle-output false-kills; multiple concurrent 2-implement runs since (scanner+refspec, etc.) confirmed viability. The watchdog trio is now **2/3 landed** (#3189/#3194 committed-progress resumability, #3218 silent-edit false-kill fix); the last slice [[stall-settlement-preserves-agent-stdout]] (#3151) is the remaining trigger to formally relax the serial-only rule. In practice 2 concurrent implements are already safe; hold 3+ (18/18 saturation) and keep verifier-file implements serial.

## Prompt corpus (2026-08-29 review)

Six seeds from the 2026-08-29 prompt review (49 files / ~1,700 lines under `prompts/` plus `shared/prompts/` assembly; every file classified live-v2 / live-v1 / both / dead against both engines), added in #3079:

| P | Seed | Rationale |
| --- | --- | --- |
| **P1** (small, any time) | [[split-spec-guidance-agent-core]] | Stops injecting all 30KB of `spec-guidance.md` into every plan/intent invocation (5–7 renders/plan run); the only prompt seed with a recurring dollar payoff. Independent of the restructures |
| **P2** (cheap, any time) | [[prompt-corpus-dead-weight-sweep]] | 4 dead prompt files, the phantom `patch.prompt.review-actuator` id, the consumer-less `promptIds` field, an unreachable v1 critic branch; same dead-surface class as [[dead-export-and-test-seam-gates]] |
| **P2** (after the guidance split) | [[plan-draft-rules-single-source]] | Failing-test / guard-inversion / agent-verifiable-AC rules each ship twice, worded differently; needs the agent-core home to exist first. Note the guard-inversion half retires with [[retire-mutation-checkpoint-dsl]] — sequence after it so the rule is not consolidated then deleted |
| **P2** (between restructure landings) | [[terse-review-role-prompts]] | Converge plan/implement review roles to the intent family's style (~⅓ the size); fold the patch/implement byte-duplication; content-only, no structural coupling |
| **P2** | [[declarative-prompt-fragment-policy]] | Same defect mechanism as the dispatch-parity class ("assembled twice, one copy stale") — the prompt-layer instance; slot with the structural retirements |
| **P3** | [[implement-owns-its-prompt-ids]] | Biggest churn, least urgency; v2 implement still runs on `patch.prompt.body`; sequence after terse-review-roles + fragment-policy so the same artifacts are not rewritten twice; pairs with the rename-lane re-triage |

## CLI surface verdicts (2026-08-29 inventory)

Keep: `daemon start|status|stop` (runtime-smoke verifier shells them), `run list|log|wait|kill|resume` (documented recovery verbs; `run kill` is the only abort for a live pipeline stage), `run workflow *`, `pipeline *`, `cleanup`, `tui`, `init`. Retire now: `write`, the three legacy aliases, `TuiDaemonClient.start`. Retire sequenced: `run pause` → `run start` → `config`. Merge: the run/pipeline dismiss pairs. Details and evidence in the two CLI seeds.

## Rewrite ledger (2026-08-29)

- Retired briefs: `tui-command-center-brief.md` (phase complete 2026-08-10), `tui-pipeline-continuation-brief.md` (every row landed or carried: attention-segment #3007, publishes-despite-no-work-shrink #3015/#3018, guard reprompts #2853), `pipeline-attribution-and-hygiene-brief.md` (superseded here).
- Reaped: ready-intent `landing-failed-names-its-cause` (#2980 verified on `main`); seed `pipeline-dispatch-threads-project-ready-and-fix-commands` (#3060 merged).
- Demoted to seeds with inline notes: `concurrent-load-suite-margin-check`, `daemon-test-concurrent-load-isolation`, `workflow-runner-test-concurrent-load-isolation` (verify-or-reap), `rename-pipeline-lane-{persistence,rpc,execution,operator-surfaces}` (post-settlement; persistence slice absorbs the `workflowInvocationId`→entry-run-id rename), `configure-pipeline-supersede-policy`, `settle-superseded-pipeline-prs`, `retire-superseded-pipeline-branches` (re-scope post-settlement).
- Kept ready-intent: `daemon-start-sweeps-orphan-gate-children` (prereqs landed, orthogonal).
- New seeds from the review and the #3060 hand-finish: the fourteen linked above.
- 2026-08-29 PM additions: [[retire-mutation-checkpoint-dsl]] (operator ask — retires the checkpoint DSL layer, keeps diff-derived verification; P1 above); the six prompt-review seeds (#3079, see Prompt corpus above); [[implement-publication-reuses-closed-same-branch-pr]] (P0 hand-finish blocker). Reaped `deferred-settlement-resume-preserves-pr-evidence` (spec merged). Demoted `daemon-resume-honors-injected-config-path` to P3 (re-scoped; #3067 closed).

Test strategy unchanged: pure functions + injected input hook for TUI; daemon/state tests for pipeline items; no assertion dropped in any split (inventory-diff before merge).
