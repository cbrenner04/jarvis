# Structural recovery brief

Phase tracker for the v2 structural recovery, from the 2026-08-29 code review of `v2/src`. **Standing document**: current priorities and operating rules only. Session narratives live in `reports/` (one per session since the reset); per-seed tracing lives in [`structural-recovery-seed-ledger.md`](./structural-recovery-seed-ledger.md). Rewritten 2026-09-05 (compaction) from the journal it had become.

## Why this phase, and where it stands

237 of 376 v2 code commits over the six weeks before the reset were fixes, clustered on a handful of structural seams — terminal state written on the happy path only, config assembled twice with one copy stale, settlement copied then redriven. The recovery's charter: five structural retirements that close whole classes — one dispatch front door, settlement derived from run rows, atomic terminal writes, the module splits, dead-export/test-seam gates.

**As of 2026-09-05 it is mostly working**: since 08-31, 11 of 79 `v2/src` commits were fixes (~14%, was 63%), zero reverts. Closed: front-door chain (#3226 et al.), both module splits (workflow-runner #3380/#3388/#3393, daemon #3364–#3394), mutation-gate P0 chain (4/4), watchdog trio, external-spec chain (#3122), notification-sweep CPU fix (73–98% → 4.6–15%), daemon socket/status honesty (#3468–#3473), CLI retirements (`write`, aliases, `TuiDaemonClient.start`). The remaining bug frontier is concentrated where the one unfinished retirement lives: **chained/linked-row settlement and resume** (the 09-02→09-05 issue wave: #3462/#3463/#3395, #3464, #3400, #3433), plus the external/`plan.commit:false` family mid-chain.

| Defect class (pre-reset taxonomy) | Fixes | Status |
| --- | --- | --- |
| Runner/write-loop settlement + resume honesty | 30 | atomic-store + daemon/write-loop consumers landed; workflow-runner 01 landed, 02 deferred |
| Mutation/plan-contract verifier | 26 | gate chain complete; scanner-based; escape hatch live |
| Cleanup/worktree management | 27 | lossless git-status landed; [[cleanup-improvements]] carries the rest |
| Pipeline stage settlement/lifecycle | 24 | **the open front** — [[pipeline-settlement-derives-from-run-rows]] |
| Daemon restart/reconciliation | 23 | absorbed into the settlement seed (#2996/#3030 shapes) |
| Error attribution ("the row lied") | 18 | honesty invariant applied at daemon status (#3473), incidents (#3418); linked-row projection remains |
| Ready-gate repair scope | 14 | autofix scoped #3343; fence policy decided 2026-09-05 — chain queued |
| Dispatch parity CLI vs daemon | 11 | front door complete; the class's new instance is the linked-row matcher split |

## Priority-ordered work

| P | Item | Why now |
| --- | --- | --- |
| **P0 — dated fuse** | [[importer-cap-counts-realized-not-surface-total]] | Cap 200, `v2/src` at 165 test files and climbing; at the cap the whole v2 mutation gate fails surface-wide. Cheapest fix on the board vs blast radius |
| **P0 — top issue generator** | [[linked-run-rows-resume-and-settle-uniformly]] (#3462/#3463/#3395), then [[pipeline-settlement-derives-from-run-rows]]: [[canonical-pipeline-execution-state-and-stage-claims]] (rewritten) → daemon-terminal-run-stage-settlement | The 09-05 issue wave is this seam; the matcher spec is the bridge fix, the settlement retirement is the class close. Everything it was sequenced behind has landed |
| **P0 — operator pain** | [[pipeline-restart-discards-disposable-stage-state]] | Restart refuses on throwaway state; three chess lanes needed hand surgery 2026-09-05. Also unblocks the dogfooding cadence itself |
| **P1** | External chain: `pipeline-external-chained-resolution` spec (planned #3484, covers #3374/#3417) → [[all-spec-documents-external-capable]] flip → [[cleanup-external-spec-home-lifecycle]] | Blocks the operator's homestead work; foundation #3483 landed. Re-repro #3374/#3417 first |
| **P1** | Structural-invariant chain: locator spec (active, 0/8) → the three `*-anchors` RIs → docs RI | Ten+ instances of the brittle-invariant class; every extraction pays it until re-keyed. Strictly serial behind the locator |
| **P1 — cheap, growing** | [[sweep-dead-mutate-directives-from-test-corpus]] (74 files); [[watchdog-timers-never-hold-the-event-loop]] pin test | Both grow or recur with every implement that copies patterns forward |
| **P2** | Fence chain: [[ready-gate-repair-out-of-diff-edits]] → [[remove-ready-gate-repair-fence-bypass-from-production]] | Policy decided 2026-09-05 (absolute fence, honest settlement); closes #3040's dead-end and the wedged-cleanup debris |
| **P2** | [[per-project-config-overrides-seam]]; [[superseded-daemon-releases-run-ownership]]; [[implement-base-fails-closed-on-stale-local-main]]; [[quota-classification-covers-every-step-role]]; [[intent-split-covers-sibling-repo-surfaces]]; [[implement-respects-target-repo-doc-layout]]; [[detached-pipeline-plan-stage-consumes-ready-intents]] + [[intent-resume-consumes-its-seed]] | The multi-project dogfood frontier: each has fresh evidence from chess/homestead |
| **P2 — in-flight specs** | finish `pipeline-resume-recover-stale-reset-override-flags` (2/4, docs) and `pipeline-resume-plan-lane-owns-preamble` (1/3); run `inject-daemon-write-loop-binding-deps` (0/1) | Open dirs block cleanup and confuse routing; small remainders |
| **P2** | [[cleanup-improvements]] (now 7 defects incl. session-log retention); hygiene RIs (dead-export gate family, dedupe trio); [[cli-retire-run-start-pause-and-config]]; prompt-id RI chain | Slot between structural landings |
| **P3** | [[mechanical-cruft-pass]]; [[superseded-pipeline-pr-hygiene]] (re-scope post-settlement); [[merge-publication-resume-twins-compute-resumable]] (pure dedup); display/TUI seeds; [[full-light-review-pipeline]] | Parked until the settlement seam settles |

## Operating notes

**Circuit-breaker (per-lane, per-gate).** If a lane (plan / implement / review) needs hand-intervention twice in a row on the same gate, stop routing that lane through Jarvis until the gate fix merges — hand-land the work instead. Re-open the lane only after one clean end-to-end run on the fixed gate. Mirrored in [operator-runbook.md § Circuit-breaker](../docs/operator-runbook.md#circuit-breaker-stop-routing-a-lane-that-keeps-failing-the-same-gate).

**Parallelization.** Intents/plans are load-robust (5/5 at load 30). Implements: 2 concurrent is sanctioned; the ceiling has never been cleanly measured — every apparent lane-count limit so far was orphaned test workers or external contention. Attribute by process family before believing a ceiling; never run local suites beside a live implement gate. Approve fan-out gates serially: head lane first, land, then resume ([[plan-bases-off-a-declared-prerequisite-branch]] + [[pipeline-fan-out-lanes-serial-chained-bases]] are the structural answer).

**Land-a-slice.** A multi-subspec spec converges only with immediate re-dispatch after each merged slice, `cleanup --yes --abandon` between. Treating a merged slice as the finish line strands doc subspecs permanently.

**Guards that destroy.** A guard deciding whether to destroy or land something treats every inconclusive answer as "do not act" — `ENOENT` from a sandboxed caller is inconclusive, not authoritative (the socket outage), and a test that asserts a recorded field is not a test that the behavior happens (#3483's consumption bug).

**Plans invent precision.** A criterion naming a test that does not exist passes review and blocks ticking later; verify named tests exist at plan review, and prefer discovery scripts over hand manifests (the #3442 narrowing).
