# Session 2026-09-18: the queue cleared, and the operator was the bottleneck twice

Continuation of [`20260917T220136Z-every-implement-pr-carried-a-defect-the-gates-passed`](./20260917T220136Z-every-implement-pr-carried-a-defect-the-gates-passed.md), which closed early on a quota misread. **The misread was mine**: three lanes settled `quota_exhausted` / `retry_later` and I wound the session down, when the payload said `five_hour` rejected with `seven_day` at 0.38 and a `resetsAt` four minutes out. The harness classified correctly *and* told me to retry later. Everything below happened after that window passed.

**18 PRs merged across the whole session.** Issue #3949 closed end to end, the daemon-outage defect closed, and the settlement seam's foreign-owner hole closed.

## What landed after the reset

| PR | What |
| --- | --- |
| [#4020](https://github.com/cbrenner04/jarvis/pull/4020) | plan: `recover-admits-landing-failed-plan-write-row` (amended before merge) |
| [#4021](https://github.com/cbrenner04/jarvis/pull/4021) | runbook: `quota_exhausted` is a rolling window — read `resetsAt` |
| [#4022](https://github.com/cbrenner04/jarvis/pull/4022) | **impl:** outgoing generation rebinds when its committed successor dies |
| [#4023](https://github.com/cbrenner04/jarvis/pull/4023) | **impl:** stage settlement treats foreign-owned rows as live |
| [#4024](https://github.com/cbrenner04/jarvis/pull/4024) | ledger: second-half lanes and three operator errors |
| [#4025](https://github.com/cbrenner04/jarvis/pull/4025) | **impl:** `recover` admits a `landing_failed` plan write row |
| [#4026](https://github.com/cbrenner04/jarvis/pull/4026) | archive the three landed specs |

## #3949 is closed, all three lanes

The prompt asked for decisions "one per line", which renders as a soft-wrapped paragraph and deterministically fails the staged `no-hard-wrap` lint, with no recovery. Closed by: the prompt now asks for a bullet list (#4013), the normalizer bulletizes bare lines at staging (#4017), and `pipeline recover` now admits a `landing_failed` plan write row whose staged tree is present (#4025).

Residual, recorded rather than fixed: a bare line *following* an authored bullet is deliberately left as a continuation and still fails the lint, so the class is narrowed, not eliminated.

## Review kept finding what the gates passed

**#4022 — the red gate was real, the repair was real, and my diagnosis was wrong.** Four of its own new tests failed: `start` refused `daemon_superseded`, admission never reopened. I concluded "the watch isn't firing." The actual cause, found by review: the test set `fallbackMs: 200`, and that same knob arms the **pre-commit fallback timer**, so the fallback fired its own rollback before `handoff_commit` landed — setting `wasSuperseded()` true, which is why admission stayed closed. Production was correct from its first commit; both repair commits were pure test-cadence fixes (`200 → 3_000 ms`, a console capture moved before commit, one synchronous assertion polled) with **no assertion loosened**. Verified by diffing the test file across the repair commits specifically, because a self-repaired gate is exactly where test-weakening would hide.

**#4023 — clean, and falsified empirically.** Reverting production to merge base gives 417 pass / 12 fail against 429 / 0 on the branch. Both corrections I made to its plan were honored: `owner_identity` joined `RUN_COLUMNS` and the exported `Run` rather than becoming a fifth bespoke `SELECT`, and `adoptAndSettlePipelineStage` got the gate instead of the exemption the draft asserted. The property that matters most: an **inconclusive liveness probe holds settlement** rather than settling under a live foreign owner.

**#4025 — safety proven by probe, not by reading.** 22/0 on branch, 19/3 at merge base, and the three failures are exactly the three ACs that claim falsification. The reviewer ran an ad-hoc probe confirming an operator `## Blocker` still refuses `operator_blocker` with no `durable/` created, and confirmed landing still revalidates rather than redrafts (every new test installs a review step whose `invoke` throws if dispatched; none threw).

## Plan review is worth as much as diff review

**#4020** was amended twice before merge. `admitPlanRecoveryBlockerAndClaim` ran its live-claim check only on the review-failed branch, so the blocked-write branch this row now travels had none — and `landing_failed` is precisely the state where an operator plausibly fired `pipeline resume` (which redrafts the same branch) before reaching for `recover`. Added as a decision plus a falsifiable criterion, and the implementation shipped it with a test that fails pre-change. Its dropped `## Prerequisites` were also restored.

Notably the drafter was **more accurate than its own intent**, which claimed the `landing_failed` settle is `resumable: true`; both settle sites show `false`, and the draft silently corrected it.

## Operator errors

Three, all mine, all cheap to avoid:

1. **Read a `five_hour` window rejection as terminal quota** and closed the session. Runbook bullet in #4021 with the telemetry one-liner: `five_hour` rejected with `seven_day` headroom means pause until `resetsAt`; only a rejected `seven_day` ends a session.
2. **Resumed a slot-refused lane on a settle event instead of on quiescence.** `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` is 1 and nothing re-drives a refusal, so the operator is the queue. Lane 3 was refused, resumed while a third lane still held the slot, refused again — two dispatches on my misjudgement. Also: "three concurrent implements" means lanes not dying, not three holding gates.
3. **Trusted a local test run against a commit the branch had already replaced** during repair, and reported a genuine red gate that CI had already shown green. Both observations were true of different commits.

## Measured: shrink is 26% of implement spend, and unbounded

Shrink is a write loop that runs until the agent returns `no-work`, so a lane always pays one extra full invocation to discover completion, plus however many rounds the agent takes. Per-lane iteration counts this session: 1, 1, 1, 1, 2, 3, 4, 4 — and cost share tracks them: **0–8% at one iteration, 35% and 65% at four**. Session total **$16.40 of $62.70 across implement lanes**.

Lane 3's four passes: two productive (net −36 lines across production and tests), one net-zero rewrite (10 added, 10 removed, same file), one `no-work` confirmation ($0.77, 111s). Whether the net-zero pass is genuine restructuring or churn is not answerable from one sample.

Left as an operator decision, same as the 2026-09-16 mutation-verification measurement — not seeded.

## Cost

**Operator $128.82** (opus-5; 1h 24m 45s API across 9h 48m 36s wall; 143.8k in / 359.0k out with 206.2m cache read, 99% of input served from cache) **plus agent $79.94** = **$208.76** for the session. Those operator figures cover *both* reports — this and #4019 are one continuous session — so they are recorded once, on this row.

Agent side: **92 invocations, $79.94**, all claude (85 `ok`, 4 `error`, 3 `quota`). The four `error` rows are normalized rejections from invocations I aborted (one `ceiling_headroom` kill, one shrink abort, lane 3's two slot refusals) — all $0.00, so the queueing mistakes cost dispatches, not money. Roles: implement 21, shrink 17, actuator 12, adversary/advocate/adjudicator 11 each, plan 8, critic 1.

## Open at close

Stopped at lane 3 by operator instruction. Remaining, in the brief's own order:

1. `wal-lock-holder-child-exits-silently` — seeded, never planned
2. `implement-can-run-integration-slice-tests` — seeded, never planned
3. `ready-gate-repair-out-of-diff-edits` — seeded, 3 recurrences

Queued behind those:

- **Two ready-intents consuming #4011's settled-marker store** — `owning-daemon-writes-invocation-settled-marker` and `run-ad-hoc-terminal-derives-from-settled-marker`. #4011 landed only the store layer, and its types were de-exported to satisfy the dead-export gate, so the first consumer PR must re-export them.
- **Six plan-only specs**, audited at session start and still unimplemented: `cleanup-archives-hand-landed-specs`, `tui-consumes-retained-pipeline-list`, `bulk-terminal-run-dismissal-cli`, `stage-success-reopens-skipped-successors`, `persist-gate-refusal-recovery-state`, `serve-canonical-failures-from-daemon`.
- **`surviving-mutation-settlement-records-killing-set`** — subspec 00 landed via #3787, subspec 01 outstanding.

Not seeded, one occurrence each: `tickWatch` does not reset the internal `superseded` flag, so a recovered generation that later takes a fresh changeover and rolls it back stays non-admitting; and #4025 has no end-to-end test pinning that `pipeline recover` reaches the widened admission (reachability was hand-verified through `findBranchFailedWorkflowStage`, but a future upstream tightening could strand it with all 22 unit tests green).

Pipeline `a9b661d5` was dismissed after its three lanes landed. Issues #3974 and #3949 stay open until their implementations close them.
