# Structural recovery brief

Standing document: what is open, in what order, and the operating rules that still earn their place. Rewritten 2026-09-18 from a full backlog audit; refreshed 2026-10-01 against `main` @ `cebeb7b39`. Session narratives live in `reports/`; per-item tracing in [`structural-recovery-seed-ledger.md`](./structural-recovery-seed-ledger.md). Neither document is a journal: when a session lands something, move the row, do not append a paragraph.

## Where it stands

The 2026-08-29 charter is done. All five structural retirements landed (front door, run-row-derived settlement #3745 + foreign-owner liveness #4023, atomic terminal writes, both module splits, dead-export/test-seam gates), and the three frontiers that followed them are closed: **publication** (#3794 and its three lanes), **daemon identity** (stable address, self-handoff, committed-successor watch #4022; digest artifacts retired #3903), and **recovery honesty** (linked-row resume through the workflow #3977/#3982, owner stamping #3981/#3987, conclusive base-ref probe #3990/#3995, committed-lane continuation #4014, `recover` on `landing_failed` #4025). Fix share of `v2/src` commits fell from 63% pre-reset to ~14% and has stayed there.

The 2026-09-20 session closed every remaining P0. All five P0 rows are gone: ready-gate repair targets the failing step (#4085), fence-derivation failure is named (#4090), publication tails settle `failed` (#4088) and legacy rows migrate (#4109), linked-implement routing persists a real row (#4087), and both load-flake P0 seeds became evidence-gated or specced (#4092/#4093 → #4097, #4098). Chain A is complete (#4046 → #4096 → #4110) and chain B is complete (#4056 → #4074 → #4091). Chain C landed all five subspecs (#4108) and chain D landed killing-set 01 (#4102); both keep tail ready-intents, now unblocked. Also landed: cleanup archives hand-landed specs (#4107), cleanup reaps orphan session logs (#4086), explicit reset flag names the continue path (#4089), importer discovery scans the scripts surface (#4099).

The 2026-09-21 session closed the regression P0 (#4132) and every dispatchable tail: chain C (#4151), publication (#4145), chain D link 2 (#4138). Also landed: IPC connect bound (#4136, #4152), inconclusive daemon liveness (#4143), retirement safety (#4140, #4147), pipeline-resume chain head (#4149), explicit resume of interrupted stages (#4154, closes #2996), decision verbs claim from any draining generation (#4153), intent stage discards vendor dirs (#4142).

What is left is no longer a fixed point that strands complete work. It is chain tails, the resume-surfaces chain, dogfood quality, and parked display work.

Counts after the 2026-10-01 second-session closeout: 12 open spec dirs (11 merged awaiting cleanup archive, 1 implement in flight) and 12 queued ready-intents; 5 dispatchable, 1 waiting on the in-flight lane, 5 chained, 1 evidence-gated. 23 seed files (6 consumed, awaiting reap). Landed: ledger § Landed.

## Priority-ordered work

2026-10-01 second session landed 13 implements (operator-merged publication, lane-PR history, review-feedback launch, plan-draft shape, agent-abort group reap, self-parsing locator, TUI single supervisor, inflow mutation repair, superseded-branch retirement, failed-settlement usage, ready-gate repair scope, resumed-settle notify) and queued the rejected pipelines' dependents as ready-intents (ledger § Landed).

| P | Item | Why |
| --- | --- | --- |
| **P1** | [[wal-lock-holder-child-survives-to-marker]] — **evidence-gated**, do not plan | Must not be planned until an operator pastes a captured rejection into it (#4101); plan PR #4100 was rejected for un-tickable criteria |
| **P1** | Lane-PR outcomes: [[lane-pr-outcomes-settle-runs-and-stages]] → [[daemon-projects-lane-pr-settlement]], [[resume-admits-lane-pr-republish-opt-in]] | Operator merge/close of a lane PR still does not settle its run and stage (#4322 #4331 landed the publication half) |
| **P1** | Plan-draft shape: [[plan-draft-shape-contract-reprompt]] → [[plan-draft-shape-operator-docs]] | #4332 names the failure; the planner is not yet reprompted with it |
| **P1** | Agent process groups: [[implement-run-records-agent-process-groups]] → [[daemon-sweeps-recorded-agent-groups]] | #4335 reaps on abort; agent groups are still invisible to `run kill` and the orphan sweep |
| **P1** | Self-parsing tests: [[resume-path-inventory-binds-real-declaration]] → [[self-parsing-structural-test-docs]] | #4345 fixed the shared locator; the resume-path inventory still binds the first match |
| **P1** | [[pipeline-resume-address-review-cli]] | #4326 landed the daemon launch; no CLI verb reaches it |
| **P1** | Mutation repair: [[resume-mutation-repair-reverifies-before-repair]]; [[mutation-verifier-fails-fast-on-first-killing-file]] | Resume repairs survivors an operator commit already killed (#4331, #4332); the verifier keeps running after a killing file fails |
| **P1** | [[notifications-wait-survives-daemon-handoff]] | `wait` dies `IPC connection lost` on every daemon handoff |
| **P1** | [[write-loop-test-split]] (after `completion-commit-run-scope` lands) | `write-loop.test.ts` exceeds the file budget and is classified load-sensitive (#4340) until split |
| **P2** | Dogfood quality: [[implement-respects-target-repo-doc-layout]] (#3426); [[intent-split-covers-sibling-repo-surfaces]] (#3439); [[detached-pipeline-plan-stage-consumes-ready-intents]] (#3041); [[per-project-config-overrides-seam]] (#3026/#3150); [[implement-can-run-integration-slice-tests]] | Each recurs but none strands a lane |
| **P2** | Fan-out: [[pipeline-fan-out-per-lane-terminal-settlement]]; [[pipeline-fan-out-lanes-serial-chained-bases]] | Fan-out pipelines still derive `failed` after every lane succeeds |
| **P3** | [[fold-shared-into-v2]] → [[retire-v2-nomenclature]] (fold in; lowish priority) | `v2` is a planning-era label; there is no v3 |
| **P3** | [[agent-confinement-is-per-vendor-and-unexpressed]] (#1453); [[cli-retire-run-start-pause-and-config]]; [[tui-dock-command-grammar-mirrors-cli]]; [[tui-typed-run-steering-clears-command-input]] | Parked; see the open decision on `run pause` below |

Dispatch order for the next session: run `cleanup -y` to archive the 11 merged spec dirs and reap the 6 consumed seed files; plan the five chain heads in parallel (lane-pr outcomes, plan-draft reprompt, agent process groups, resume-path inventory, address-review CLI) and dispatch each dependent after its head merges; intent the three new P1 seeds; plan `write-loop-test-split` once `completion-commit-run-scope` lands. Leave [[wal-lock-holder-child-survives-to-marker]] alone until a captured rejection exists. Read `## Prerequisites` before approving any fan-out gate.

## Contradictions and decisions surfaced by the audit

- **Retired 2026-09-29, by design:** extending stale-reset gate 2 to out-of-root spec trees (seed `stale-reset-destroys-commits-for-external-specs`, #3433). Plan blocker showed no loss path: retirement never touches those trees, commits are guarded by gates 1/3, continuation (#4014) and the unlanded refusal (#4140/#4147), and tip SHAs are in the destroyed-artifacts block. Recorded in `v1-behaviors.md`.

- **Retired 2026-09-29 as a false premise:** `run-resume-returns-admission-refusal`, `run-projection-names-resume-refusal`, `tui-surfaces-resume-refusal`. `run resume` never reaches the stale-reset gates (`maybeResetStaleWorkspace` is called only from workflow start and pipeline re-dispatch), and its admission refusals already return RPC error frames. The gap is pipeline-only.

- **Retired 2026-09-18 as a contradiction:** `merge-pipeline-stage-pr-at-its-approval-gate` prescribed merging the intent PR at `approve-intent` and re-resolving the plan base, the opposite of [[detached-pipeline-plan-stage-consumes-ready-intents]] (consume from the source the plan actually read) and of `first-workflow-walkthrough.md`, which says inter-stage merging is not required. Consume-from-source is kept; the stacked-PR cleanup half moved to `superseded-pipeline-pr-hygiene` (consumed 2026-09-30). Revert by restoring the seed if you prefer merge-at-gate.
- **Open decision, `run pause`:** [[cli-retire-run-start-pause-and-config]] deletes it first, while #3853 added a `run-paused` incident on every paused row and [[tui-dock-command-grammar-mirrors-cli]] aligns the dock to it. Decide whether pause stays before planning either seed.
- **Corrected in place:** [[implement-can-run-integration-slice-tests]] decision 3 contradicted `prompts/implement/rules.md:29` (#3867, tick harness-run suites on in-sandbox checks); re-scoped to measurement criteria. [[intent-split-covers-sibling-repo-surfaces]] relied on a `siblings` key that exists only in frozen v1. Spec `stage-success-reopens-skipped-successors` intent said same-transaction, its subspec says separate; the intent now matches the subspec.
- **A seed PR is not a fix.** The brief once marked #3833 and #3832 landed by citing the seed PRs themselves; #3833 has since landed for real (#4065), and `daemon-status-reports-stopped-on-a-busy-daemon` landed #4143.
- **A ready-intent premise that the source refutes:** `workflow-terminal-waits-await-durable-boundary` blamed a 5 s test deadline; `bunfig.toml` already sets `[test] timeout = 30000` and `workflow.test.ts` contains no `5000`. Plan PR #4105 was rejected on the premise. The real bound is `CONNECT_TIMEOUT_MS = 5_000` in `v2/src/ipc/client.ts:11`, fixed by #4136/#4152. The ready-intent is retired (#4119).
- **Retired 2026-10-01 as already closed:** `detach-admission-refuses-without-a-run-row` asked `--detach` to refuse without a run id, contradicting #4087. Source shows #4087 closed the gap: `persistLinkedRoutingRow` (`workflow-runner.ts:837`) persists and settles the row before `onStepRunCreated`, every preset's step 0 is a durable write step, and `--detach` exit `0` already means admitted (`operator-runbook.md`). Pinned by `workflow-runner-debate.test.ts` "persists a non-in-progress row for every id reported…".
- **Decision, interrupted pipelines (#4154):** restart continuation does not auto-continue an interrupted pipeline; explicit `pipeline resume` only.
- **Deferred, decision-verb prefix resolution (#4153):** older-generation pipelines need the full id.
- **Issues closed:** #3949, #3974, #3372 (2026-09-18); #3040 (2026-09-20, #4085). #3423 (#4090), #3417 (#4076). #2996 (2026-09-21, #4154).

## Open observations (not seeded)

- Implement reports complete after only subspec 00 of a multi-subspec tree; twice (#4149, #4154), caught only by diff review.
- TUI hides a live resumed run whose invocation entry row is terminal.
- `run-ad-hoc-terminal` / `pipeline-terminal` `failed` notifications fire on every `slot_contention` gate refusal; mostly addressed by #4149.
- A leaked `launchd`-parented test orphan (`bun -e ... CURRENT_OWNER_IDENTITY ... setInterval`) held a worktree for hours and plausibly produced false mutation-gate verdicts.

## Operating rules

**Circuit-breaker (per-lane, per-gate).** A lane needing hand intervention twice in a row on the same gate leaves Jarvis until the gate fix merges; hand-land instead, re-open after one clean end-to-end run. Mirrored in the runbook.

**Parallelization.** Working number is three concurrent implements and one gate slot (`MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1`, conservative, operator decision to leave it). Resume a slot-refused lane on zero live lanes, not on a settle notification. Slot refusals now re-drive automatically (#4074); do not hand-resume a slot-refused lane. Intents and plans fan out freely; approve fan-out gates back to back after reading `## Prerequisites`. Do not merge `v2/src` while lanes are live. Merge `v2/src`/`shared` PRs as one batch: back-to-back merges once left three daemon generations and refused decision verbs for ~30 min (#4153 lets verbs claim from any draining generation).

**Never merge an autonomous implement without an independent diff review.** Measured: 2026-09-17 late, 3 of 5 implement PRs carried a defect the gates passed (#4012, #4014, #4017: ticked criteria on tests that exercised nothing, dropped guards, corruption cases); 2026-09-18/19 full session, 6 of 17 (#4060, #4061, #4065, #4067, #4073; #4058 weak test). Review also catches weak-but-harmless tests the gates cannot see. A green mutation `pass` is not evidence either: read `acceptedSites`, and commit before running it. A verdict formed under an orphan or heavy load can be false in both directions; flip-test by hand before adding tests. A ticked criterion whose only evidence is a `*.sandbox-unrunnable` file is unverified.

**Salvage beats re-dispatch.** A strand after the work is committed is a publishing problem: rebase the branch onto current `main`. Check `git diff origin/main...<branch>` before hand-implementing "remaining" subspecs, and `git log -1` in the worktree before trusting a local run against a lane under repair.

**A dirty guard in a wedged worktree may be the verifier's mutant.** Check parentage of any hot `bun test` (`ps -o ppid=`) before concluding anything: daemon-parented is a live gate child, `launchd`-parented is a leaked orphan.

**Guards that destroy treat inconclusive as "do not act".** `ENOENT` from a sandboxed caller, a failed `gh` probe, a timed-out socket probe: none is authoritative. `daemon status` now reports an inconclusive probe as such (#4143).

**Land-a-slice.** A multi-subspec spec converges only with immediate re-dispatch after each merged slice.

**Quota is a window.** `five_hour` rejected with `seven_day` headroom means pause until `resetsAt`; only a rejected `seven_day` ends a session.

**Plans invent precision, and `@mutate` pins that do not kill are worse than none.** Verify named tests exist at plan review; verify a pin by deleting the line it names. A mechanical post-hoc rewrite of agent output is a defect surface (the #3628 lesson), so prefer a reprompt to a normalizer.

**Two green CI runs pinned to `headSha` for daemon or publication PRs.** One green run proves little for flaky tests, and a conflicting PR runs no CI at all.

**Close a pipeline's intent or plan PR as subsumed once its next stage has completed — never merge it:** the next stage consumed it from the branch, and merging re-adds stale ready-intents. Close plan PRs as soon as the implement starts.

**Every harness repair/resume commit is suspect:** diff each lane against its merge base and reject out-of-scope paths before merge (three lanes on 2026-09-30).

**Fix, don't seed, mechanical defects.** A leak or test-hygiene defect with an obvious fix lands as a fix PR (#4068), not a seed.

**A criterion an implement agent cannot demonstrate from inside a run belongs in operator verification, not acceptance criteria.** N consecutive runs, an idle machine, green CI: each strands the lane at no-progress, and two plans (#4100, #4105) were rejected for exactly this.

**Archive a hand-finished spec in the same session.** Cleanup never archives a spec with no run row, so its open dir later reads as unlanded work and blocks dependent plans.

**Intent splits default to over-chaining.** Reject a fan-out whose lanes are coupled (shared file, docs-only lane, strict chain) and hand-assemble one ready-intent with chained subspecs; happened 3x on 2026-10-01 (write-loop 9 lanes, TUI 2 coupled lanes, plan-draft-shape docs-only lane).

**After committing a killing test, resume can still exhaust on a stale survivor** until [[resume-mutation-repair-reverifies-before-repair]] lands; hand-run `verifyDiffDerivedMutations` instead of resuming.
