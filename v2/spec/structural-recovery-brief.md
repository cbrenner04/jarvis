# Structural recovery brief

Standing document: what is open, in what order, and the operating rules that still earn their place. Rewritten 2026-09-18 from a full backlog audit; refreshed 2026-09-21 against `main` @ `a076cafff`. Session narratives live in `reports/`; per-item tracing in [`structural-recovery-seed-ledger.md`](./structural-recovery-seed-ledger.md). Neither document is a journal: when a session lands something, move the row, do not append a paragraph.

## Where it stands

The 2026-08-29 charter is done. All five structural retirements landed (front door, run-row-derived settlement #3745 + foreign-owner liveness #4023, atomic terminal writes, both module splits, dead-export/test-seam gates), and the three frontiers that followed them are closed: **publication** (#3794 and its three lanes), **daemon identity** (stable address, self-handoff, committed-successor watch #4022; digest artifacts retired #3903), and **recovery honesty** (linked-row resume through the workflow #3977/#3982, owner stamping #3981/#3987, conclusive base-ref probe #3990/#3995, committed-lane continuation #4014, `recover` on `landing_failed` #4025). Fix share of `v2/src` commits fell from 63% pre-reset to ~14% and has stayed there.

The 2026-09-20 session closed every remaining P0. All five P0 rows are gone: ready-gate repair targets the failing step (#4085), fence-derivation failure is named (#4090), publication tails settle `failed` (#4088) and legacy rows migrate (#4109), linked-implement routing persists a real row (#4087), and both load-flake P0 seeds became evidence-gated or specced (#4092/#4093 → #4097, #4098). Chain A is complete (#4046 → #4096 → #4110) and chain B is complete (#4056 → #4074 → #4091). Chain C landed all five subspecs (#4108) and chain D landed killing-set 01 (#4102); both keep tail ready-intents, now unblocked. Also landed: cleanup archives hand-landed specs (#4107), cleanup reaps orphan session logs (#4086), explicit reset flag names the continue path (#4089), importer discovery scans the scripts surface (#4099).

The 2026-09-21 session closed the regression P0 (#4132) and every dispatchable tail: chain C (#4151), publication (#4145), chain D link 2 (#4138). Also landed: IPC connect bound (#4136, #4152), inconclusive daemon liveness (#4143), retirement safety (#4140, #4147), pipeline-resume chain head (#4149), explicit resume of interrupted stages (#4154, closes #2996), decision verbs claim from any draining generation (#4153), intent stage discards vendor dirs (#4142).

What is left is no longer a fixed point that strands complete work. It is chain tails, the resume-surfaces chain, dogfood quality, and parked display work.

Counts after the 2026-09-21 closeout: 1 open spec dir and 8 queued ready-intents; 4 dispatchable, 2 chained behind them, 1 evidence-gated, 1 needs a rewrite. 22 seeds. Landed: ledger § Landed.

## Priority-ordered work

| P | Item | Why |
| --- | --- | --- |
| **P1** | Chain D tail: [[repair-exhausted-error-names-site-and-killing-set]] (dispatchable, unblocked by #4138); then [[non-terminating-mutation-settlement-names-its-site]] (one-line spread, same sites) | `mutation_repair_exhausted` op spreads no site fields |
| **P1** | Pipeline resume: [[pipeline-resume-resumes-resumable-implement-row]] (dispatchable, unblocked by #4149) | A stage never reflects a lane recovered by `run resume`; follow-up: `reopenFailedStagesForResume` full-scans `listPipelines()` per admission |
| **P1** | Resume surfaces: [[run-resume-returns-admission-refusal]] → [[run-projection-names-resume-refusal]]; [[pipeline-resume-preflights-dispatch-refusals]] → [[tui-surfaces-resume-refusal]] (heads dispatchable) | Admission refusals reach only the daemon log |
| **P1** | [[detach-admission-refuses-without-a-run-row]] — **rewrite before planning**, not dispatchable | Its decisions contradict the landed `linked-implement-routing-settles-a-real-outcome`, which deliberately ruled out an id-less refusal; rewrite it to the persisted-row contract (#4087) |
| **P1** | [[wal-lock-holder-child-survives-to-marker]] — **evidence-gated**, do not plan | Must not be planned until an operator pastes a captured rejection into it (#4101); plan PR #4100 was rejected for un-tickable criteria |
| **P1** | Retirement safety: [[stale-reset-destroys-commits-for-external-specs]] (#3433) | Gate 2 is blind to external trees |
| **P1** | Cleanup and home: [[retention-tiers-for-session-logs-and-telemetry]]; [[worktree-materialization-fails-on-committed-node-modules-symlink]] (#4003, half landed) | Orphan telemetry lives forever |
| **P2** | Dogfood quality: [[review-roles-check-falsifiability-not-plausibility]]; [[implement-respects-target-repo-doc-layout]] (#3426); [[intent-split-covers-sibling-repo-surfaces]] (#3439); [[detached-pipeline-plan-stage-consumes-ready-intents]] (#3041); [[per-project-config-overrides-seam]] (#3026/#3150); [[implement-can-run-integration-slice-tests]]; [[mutation-verifier-ignores-whitespace-only-line-changes]]; [[self-parsing-structural-tests-can-bind-to-their-own-fixtures]]; [[completed-write-step-rows-stamp-finished-at]]; [[serial-rerun-includes-frozen-v1]] | Each recurs but none strands a lane |
| **P2** | Fan-out: [[superseded-pipeline-pr-hygiene]]; [[pipeline-fan-out-per-lane-terminal-settlement]]; [[pipeline-fan-out-lanes-serial-chained-bases]]; spec `tui-consumes-retained-pipeline-list` (0/2, genuinely open) | Fan-out pipelines still derive `failed` after every lane succeeds |
| **P3** | [[agent-confinement-is-per-vendor-and-unexpressed]] (#1453); [[cli-retire-run-start-pause-and-config]]; [[tui-dock-command-grammar-mirrors-cli]]; [[tui-typed-run-steering-clears-command-input]] | Parked; see the open decision on `run pause` below |

Dispatch order for the next session: plan the four dispatchable ready-intents in parallel (chain D tail, pipeline resume, both resume-surfaces heads); the two resume-surfaces successors follow their heads. Rewrite [[detach-admission-refuses-without-a-run-row]] by hand before it is planned at all, and leave [[wal-lock-holder-child-survives-to-marker]] alone until a captured rejection exists. Read `## Prerequisites` before approving any fan-out gate.

## Contradictions and decisions surfaced by the audit

- **Retired 2026-09-18 as a contradiction:** `merge-pipeline-stage-pr-at-its-approval-gate` prescribed merging the intent PR at `approve-intent` and re-resolving the plan base, the opposite of [[detached-pipeline-plan-stage-consumes-ready-intents]] (consume from the source the plan actually read) and of `first-workflow-walkthrough.md`, which says inter-stage merging is not required. Consume-from-source is kept; the stacked-PR cleanup half moved to [[superseded-pipeline-pr-hygiene]]. Revert by restoring the seed if you prefer merge-at-gate.
- **Open decision, `run pause`:** [[cli-retire-run-start-pause-and-config]] deletes it first, while #3853 added a `run-paused` incident on every paused row and [[tui-dock-command-grammar-mirrors-cli]] aligns the dock to it. Decide whether pause stays before planning either seed.
- **Corrected in place:** [[implement-can-run-integration-slice-tests]] decision 3 contradicted `prompts/implement/rules.md:29` (#3867, tick harness-run suites on in-sandbox checks); re-scoped to measurement criteria. [[intent-split-covers-sibling-repo-surfaces]] relied on a `siblings` key that exists only in frozen v1. Spec `stage-success-reopens-skipped-successors` intent said same-transaction, its subspec says separate; the intent now matches the subspec.
- **A seed PR is not a fix.** The brief once marked #3833 and #3832 landed by citing the seed PRs themselves; #3833 has since landed for real (#4065), and `daemon-status-reports-stopped-on-a-busy-daemon` landed #4143.
- **A ready-intent premise that the source refutes:** `workflow-terminal-waits-await-durable-boundary` blamed a 5 s test deadline; `bunfig.toml` already sets `[test] timeout = 30000` and `workflow.test.ts` contains no `5000`. Plan PR #4105 was rejected on the premise. The real bound is `CONNECT_TIMEOUT_MS = 5_000` in `v2/src/ipc/client.ts:11`, fixed by #4136/#4152. The ready-intent is retired (#4119).
- **A ready-intent contradicted by the spec that unblocked it:** [[detach-admission-refuses-without-a-run-row]] asks `--detach` to refuse without a run id, which the landed `linked-implement-routing-settles-a-real-outcome` (#4087) deliberately ruled out by persisting a real row first. Rewrite it to the persisted-row contract before planning.
- **Decision, interrupted pipelines (#4154):** restart continuation does not auto-continue an interrupted pipeline; explicit `pipeline resume` only.
- **Deferred, decision-verb prefix resolution (#4153):** older-generation pipelines need the full id.
- **Issues closed:** #3949, #3974, #3372 (2026-09-18); #3040 (2026-09-20, #4085). #3423 (#4090), #3417 (#4076). #2996 (2026-09-21, #4154).

## Open observations (not seeded)

- Implement reports complete after only subspec 00 of a multi-subspec tree; twice (#4149, #4154), caught only by diff review.
- TUI hides a live resumed run whose invocation entry row is terminal.
- Pipeline terminal publication runs `ready` after an operator hand-merge and fails `exit unknown` (once).
- `run-ad-hoc-terminal` / `pipeline-terminal` `failed` notifications fire on every `slot_contention` gate refusal; mostly addressed by #4149.
- A leaked `launchd`-parented test orphan (`bun -e ... CURRENT_OWNER_IDENTITY ... setInterval`) held a worktree for hours and plausibly produced false mutation-gate verdicts.

## Operating rules

**Circuit-breaker (per-lane, per-gate).** A lane needing hand intervention twice in a row on the same gate leaves Jarvis until the gate fix merges; hand-land instead, re-open after one clean end-to-end run. Mirrored in the runbook.

**Parallelization.** Working number is three concurrent implements and one gate slot (`MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1`, conservative, operator decision to leave it). Resume a slot-refused lane on zero live lanes, not on a settle notification. Slot refusals now re-drive automatically (#4074); do not hand-resume a slot-refused lane. Intents and plans fan out freely; approve fan-out gates back to back after reading `## Prerequisites`. Do not merge `v2/src` while lanes are live. Merge `v2/src`/`shared` PRs as one batch: back-to-back merges once left three daemon generations and refused decision verbs for ~30 min (#4153 lets verbs claim from any draining generation).

**Never merge an autonomous implement without an independent diff review.** Measured: 2026-09-17 late, 3 of 5 implement PRs carried a defect the gates passed (#4012, #4014, #4017: ticked criteria on tests that exercised nothing, dropped guards, corruption cases); 2026-09-18/19 full session, 6 of 17 (#4060, #4061, #4065, #4067, #4073; #4058 weak test). Review also catches weak-but-harmless tests the gates cannot see. A green mutation `pass` is not evidence either: read `acceptedSites`, and commit before running it. A verdict formed under an orphan or heavy load can be false in both directions; flip-test by hand before adding tests. A ticked criterion whose only evidence is a `*.sandbox-unrunnable` file is unverified.

**Salvage beats re-dispatch.** A strand after the work is committed is a publishing problem: rebase the branch onto current `main`. Check `git diff origin/main...<branch>` before hand-implementing "remaining" subspecs, and `git log -1` in the worktree before trusting a local run against a lane under repair.

**A dirty guard in a wedged worktree may be the verifier's mutant.** Check parentage of any hot `bun test` (`ps -o ppid=`) before concluding anything: daemon-parented is a live gate child, `launchd`-parented is a leaked orphan.

**Guards that destroy treat inconclusive as "do not act".** `ENOENT` from a sandboxed caller, a failed `gh` probe, a timed-out socket probe: none is authoritative. `daemon status` now reports an inconclusive probe as such (#4143).

**Land-a-slice.** A multi-subspec spec converges only with immediate re-dispatch after each merged slice. Implement PRs carry the spec tree, so close the plan-stage PR as subsumed once the implement merges; intent-stage PRs must merge because they carry the seed deletion.

**Quota is a window.** `five_hour` rejected with `seven_day` headroom means pause until `resetsAt`; only a rejected `seven_day` ends a session.

**Plans invent precision, and `@mutate` pins that do not kill are worse than none.** Verify named tests exist at plan review; verify a pin by deleting the line it names. A mechanical post-hoc rewrite of agent output is a defect surface (the #3628 lesson), so prefer a reprompt to a normalizer.

**Two green CI runs pinned to `headSha` for daemon or publication PRs.** One green run proves little for flaky tests, and a conflicting PR runs no CI at all.

**Close a pipeline's plan PR, never merge it before its implement lands.** Merging deletes the plan branch and strands the implement stage, and caused a spec-tick rebase conflict twice on 2026-09-21.

**Fix, don't seed, mechanical defects.** A leak or test-hygiene defect with an obvious fix lands as a fix PR (#4068), not a seed.

**A criterion an implement agent cannot demonstrate from inside a run belongs in operator verification, not acceptance criteria.** N consecutive runs, an idle machine, green CI: each strands the lane at no-progress, and two plans (#4100, #4105) were rejected for exactly this.

**Archive a hand-finished spec in the same session.** Cleanup never archives a spec with no run row, so its open dir later reads as unlanded work and blocks dependent plans.
