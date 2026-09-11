# 2026-09-11 — parallel pipeline dogfood, the gate-slot treadmill, and the publication fix

Operator session. Agent order `codex, claude`; cursor and opencode out. Started from an inherited state of 40 pipelines, 37 remote branches and 20 open issues; ended with the implement publication defect root-caused and fixed by hand.

## What landed

17 PRs merged. Implementation: [#3785](https://github.com/cbrenner04/jarvis/pull/3785) branch-scoped reopen of provisional skipped stage rows, [#3786](https://github.com/cbrenner04/jarvis/pull/3786) bulk terminal-run dismissal in the store, [#3787](https://github.com/cbrenner04/jarvis/pull/3787) surviving-mutation settlements carry their killing set, [#3788](https://github.com/cbrenner04/jarvis/pull/3788) `pipeline_list` terminal retention and filtered bypass, [#3789](https://github.com/cbrenner04/jarvis/pull/3789) glob patterns are not artifact paths, [#3794](https://github.com/cbrenner04/jarvis/pull/3794) **the publication fix**. Spec, stage and archive PRs: #3777–#3784, #3790–#3793. Open at close: [#3792](https://github.com/cbrenner04/jarvis/pull/3792) (hand-finished bulk-dismiss RPC) and [#3795](https://github.com/cbrenner04/jarvis/pull/3795) (cleanup archive).

## The publication defect: root-caused and closed

Seven implement lanes across two sessions had settled `completed` with a real commit, nothing pushed, no PR, no review or publication row, and no diagnostic. It was not a race and not environmental — three mechanisms composed, and there was no exception anywhere:

1. `prepareWorkflowStep` sets `publishCompletion: false`, and the write loop's `keepsCompletionInProgress` requires `publishCompletion !== false`, so a workflow write step's row is settled `completed` at its boundary — before the publication tail `executeWorkflow` owns.
2. The linked-implement finalizers then convert that already-settled outcome to `contract_miss`/`blocked`, and the step loop returned on any non-`complete` result with **no log append and no store write**.
3. The daemon's `execute().catch().finally()` had no `.then`, so the returned `WorkflowResult` was discarded.

There was never a throw. The daemon spawns with stderr to its keyed log and the admission catch both logs and appends `run_execution_failed`; neither exists for these runs, while another generation's log does contain a caught error — so the path works and simply was not taken. The pipeline stage's `harness_failure` is the fallthrough classifier for the row shape (1) leaves.

[#3794](https://github.com/cbrenner04/jarvis/pull/3794) settles the row at the point the outcome is known, **only when it still reads `completed`**. That narrowness is load-bearing: the first version keyed on the outcome kind and broke resume, because `budget-exhausted` and `paused` are deliberately non-terminal so the next dispatch resumes. An honesty fix that destroys work is the worse bug. Mechanism 1 was deliberately left alone — holding the row `in-progress` across the tail would strand rows on any tail path that fails to settle.

**The narrowing that found it** was a counter-example, not a pattern: three lanes failed and a fourth published cleanly. The discriminator turned out not to be fresh-vs-re-entry (my first reading, recorded and corrected) but *who publishes* — lanes that publish do it inside the write loop or the review step; lanes that defer to `executeWorkflow`'s tail are the ones gated behind (2) and (3).

## Parallelization: the ceiling moved, and it is now a treadmill

Four `full-review` pipelines launched simultaneously all reached their first gate in 6 minutes. One ran seed → intent → plan → implement in **8 minutes with two operator actions**. Branch-scoped approval behaved exactly as documented. Plans and intents fan out for free.

At five concurrent implements, load 11–17, there were **zero watchdog false-kills and zero idle-output stalls** — the 45-minute paired timeouts from earlier sessions did not reproduce. Lane count is not the ceiling and load is not the ceiling. The ceiling is the single full-suite gate slot, and past it lanes settle `gate_invocation_refused` / `resumable: true` instead of timing out. That is a real improvement.

But it is not enough, and the residue is worse than it looks. Four lanes hit the refusal; one hit it **four times**. `jarvis run resume` is the documented recovery and it re-enters the same contended slot with no better odds. Worse: **the refusal aborts before the iteration's checkpoint commit**, so those four iterations produced zero commits and zero ticked criteria while a complete implementation sat uncommitted in the worktree. Repeated refusal makes no forward progress at all, and the operator cannot see it from `run list` or the branch — only from `git status` inside the worktree. Seeded as `gate-slot-refusal-is-a-resume-treadmill`, proposing a bounded daemon-side re-drive for the transient *slot* cause only, since the daemon owns the lease set and knows exactly when that clears.

**Working number for today's harness: 2–3 concurrent implements.** Above that you pay in hand-resumes.

## The plan lane failed 3 for 3, one shape

Every plan lane settled `contract_miss` — `Plan index does not link 00-<name>.md` — and all three were the same drafter drift: the agent drafts a subspec, renames it, writes the new file, and leaves the old one beside the keeper. The index correctly links the keeper; `artifact.exists` blocks on the orphan. One `rm` corrected each. The draft prompt already carries the rule being broken, which is the argument for `plan-draft-contract-miss-reprompts-before-blocking` rather than another prompt line.

`pipeline recover` went 2 for 3 and the failure came with a control: two sibling lanes took the *identical* correction and recover admitted both; the third refused `stage_resolution_failed: stage "plan" has no preceding workflow artifact`. Same correction, same contract failure — so the refusal is the resolver's dispatch-shaped precondition, exactly as `recover-needs-no-predecessor-artifact` states.

## Review found a real defect in every autonomous work product — again

Five of five. The pattern held with no exceptions:

- **`handoff-daemon-generations`** (the P0 head lane): 21 of 27 criteria ticked, `typecheck`/`lint:md`/`test:v2` green — and **every CLI-started daemon would have superseded itself and exited ~100 ms after start**, because the peer sweep excludes only the public socket while the generation's own private endpoint matches the sweep's filter. The handoff protocol was also unreachable from production (`startDaemon` still throws before spawning), release and bind were unsynchronized in both directions, and six criteria were ticked over assertions that cannot fail — one guard is an identity function whose "both truth directions" test asserts `f(true) === true`. Not landed; findings written into the spec so the re-dispatch inherits them.
- **`pipeline_list` retention**: shipped a regression no criterion covered — the CLI never forwarded `--since`/`--state`, so the new cap silently truncated every history query. Plus `sinceMs: NaN` disabling retention entirely (fail-open), an unvalidated `state` returning an empty list instead of `invalid_params`, prefix resolution losing evicted pipelines, and a vacuous dismissed-retention test seeded so that both orderings passed.
- **`surviving-mutation` killing set**: reported `passed-unconfirmed` for observers that **never ran** or that **ran and failed** — a test asserted `passed-unconfirmed` alongside `expect(scopedRuns).toBe(0)` in the same block.
- **bulk dismissal store**: the invocation harvest filtered `dismissed_at IS NULL`, killing expansion in exactly the case the spec cites as its rationale.
- **my own publication fix**: the review caught that I had fixed only the benign half of the routing-failure path — a failure *after* a link's write loop completed minted a throwaway UUID, leaving the real row's `completed` lie intact. Also a vacuous assertion of mine that counted `attempts`, which `commitTerminalRunSettlement` never writes.

**A green mutation `pass` is still not evidence.** The final verifier run on #3794 returned `kind: "pass"` with `acceptedSites: []` — every candidate inconclusive on the deadline, because the `workflow-runner.ts` killing set is 14 files. I hand-verified both critical guards by flip-and-test instead. The *earlier* run had found a confirmed survivor on my daemon change, which is what prompted writing its tests at all.

## Daemon identity taxed this session four ways

The P0 reproduced on the first cleanup action and three more times after:

- `pipeline dismiss` refused `pipeline_no_live_owner` on two pipelines whose admitting daemon was gone. **Those two rows (`77b5ca90`, `f930a0f1`) are now permanently unshedable** — a display filter that cannot be applied is a durable listing leak.
- After merging source, every prefix-taking `pipeline` verb refused `pipeline_id_set_incomplete`: `pipeline list` tolerates a dead socket, but prefix resolution fails closed on the invoking digest's now-absent socket. Full IDs work. That is `prefix-resolution-refuses-on-an-absent-invoking-socket`, self-inflicted by my own merge.
- Source merges had to be batched around live lanes all session.

## Operator notes

- **Four CPU orphans** (`launchd`-parented, one aged 1h33m, all on the same test file) were pegging cores with nothing live — the runbook's hard-stop condition. A new cohort respawned after the first sweep, so the root had to be traced and killed. Load fell ~11 → ~5.
- **I re-dispatched a lane whose work was already on `main`** (subspec 00 had landed as #3765 last session), which cost a four-way rebase conflict. `check-spec-branch-for-unpublished-work` cuts both directions; I applied it one way only.
- **Issue triage: 20 open, none closable.** The two most likely were checked in source rather than against the brief — #2996's dead-end is intact (`resumeDeferredRefusalApplies` still returns true unconditionally for derived `interrupted`) despite the settlement seam it was absorbed into having closed.
- `sandbox-unrunnable` tests are unrun tests: every socket-backed criterion on the handoff lane was "proven" by a file the scoped gate skips, and the one CI would run failed on first execution outside the sandbox.
