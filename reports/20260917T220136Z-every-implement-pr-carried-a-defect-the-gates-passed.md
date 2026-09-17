# Session 2026-09-17 (late): every implement PR carried a defect the gates passed

Eleven PRs to `main`. Five implementations landed, two queue-head plans drafted, one seed pair opened from issue intake, one pipeline lane driven end to end, one lane hand-finished after quota killed it. **Every one of the five implement PRs carried at least one defect that the mechanical gates — mutation verification, runtime smoke, green ready gate, green CI, fully ticked criteria — passed.** None of the five would have been caught without an independent diff review.

Ended on claude quota exhaustion with the agent order set to claude-only.

## What landed

| PR | What |
| --- | --- |
| [#4006](https://github.com/cbrenner04/jarvis/pull/4006) | Seeds for intake #4003 and #4004 |
| [#4007](https://github.com/cbrenner04/jarvis/pull/4007) | plan: `daemon-committed-successor-watch` |
| [#4008](https://github.com/cbrenner04/jarvis/pull/4008) | plan: `stage-settlement-foreign-owner-liveness` |
| [#4009](https://github.com/cbrenner04/jarvis/pull/4009) | intent: `plan-landing-lint-is-recoverable` (3 lanes) |
| [#4010](https://github.com/cbrenner04/jarvis/pull/4010) | plan: `decisions-ledger-prompt-requires-bullet-list` |
| [#4011](https://github.com/cbrenner04/jarvis/pull/4011) | **impl:** workflow-invocation settled-marker store |
| [#4012](https://github.com/cbrenner04/jarvis/pull/4012) | **impl:** mutation verifier skips test-support files |
| [#4013](https://github.com/cbrenner04/jarvis/pull/4013) | **impl:** decisions-ledger prompt requires a bullet list |
| [#4014](https://github.com/cbrenner04/jarvis/pull/4014) | **impl:** re-dispatch continues a committed lane (#3974 asks 2-3) |
| [#4016](https://github.com/cbrenner04/jarvis/pull/4016) | ledger + seed for the rebased-lane push gap |
| [#4017](https://github.com/cbrenner04/jarvis/pull/4017) | **impl:** plan-draft normalizer bulletizes bare Decisions lines |
| [#4018](https://github.com/cbrenner04/jarvis/pull/4018) | archive five landed specs, prune two consumed ready-intents |

## The review record, case by case

This is the session's main finding, so it is worth the detail.

**#4012 — a criterion ticked on an ordering-dependent test.** AC2 claimed "a mixed diff yields a candidate *only* for the production file". The first survivor short-circuits the run and `src/safe.ts` was listed first in the diff, so it won on ordering whether or not the test-support file also produced a candidate. The reviewer's proposed fix (`expect(result.inspectedPaths)`) was wrong — that field exists only on the `pass` result kind — and applying it reddened two tests. The real fix is ordering: put the test file first, so a wrongly-included candidate wins the short-circuit and names itself. Verified by reverting production to merge base.

**#4011 — clean, and proven so.** Mutation-tested: deleting the schema block reddens five tests; swapping the upsert for the ruled-out `INSERT OR IGNORE` reddens the decision's own test. No `MIGRATIONS` entry was added (the table ships in the always-executed baseline `SCHEMA`), so the pinned migration count correctly stays at 9.

**#4013 — the harness caught its own gap.** The lane failed `surviving_mutation_failed` / `missing-render-coverage`, correctly: the spec's checklist named the render assertion but not the `RENDER_OBSERVER_TESTS` registration, so no observer mapped to the changed prompt. One-line mapping by hand, then `run resume`.

**#4014 — a criterion ticked on a test that executed nothing, plus a dropped destruction guard.** The daemon-dispatch test built its worktree at `<repoRoot>/.jarvis-worktrees/` while `resetStaleWorkspace` resolves `managedWorktreePath(jarvisRoot, …)`, so the function returned `no-op` before any continuation logic ran and every assertion passed vacuously — it passed unmodified against pre-change code. Repointed and `gh`-stubbed, it now fails pre-change. Separately, continuation rebases whatever the worktree has checked out while retirement keys off the branch ref, so a `HEAD` the branch cannot reach would be rebased into commits only `--abandon` could then discard. The `disposableLane` path guards exactly this; continuation was the one path that dropped it. Guarded, with a test that reddens when the guard is disabled.

**#4017 — five reproduced corruption cases, DO-NOT-MERGE until fixed.** Heading discovery was `lines.indexOf(DECISIONS_HEADING)`, a raw first match, with fence state tracked only from that heading onward. A draft carrying a fenced `## Decisions` example — which drafts about spec format routinely do — captured the pass: lines inside the code fence were rewritten and the real section was never processed. Silent corruption of a correctly-authored draft, the [#3628](https://github.com/cbrenner04/jarvis/pull/3628) shape this spec set out to avoid. The loop also mangled `###` subheadings, table rows, ordered and `*`/`+` items, blockquotes, HTML comments, and indented code. Fixed with fence-aware discovery over every unfenced occurrence plus a structural-line filter; two of the three new tests verified to fail against pre-fix semantics. The spec and `v1-behaviors.md` both claimed the hard-wrap mis-split was the only content-damaging case — untrue as written, both corrected.

Review also confirmed what mattered most in #4017 and could not be broken: the durable path is write-incapable. One `writeFileSync` in the module, doubly guarded, and only the staging caller passes `rewrite-allowed`.

## Plan review is now worth as much as diff review

Both queue-head plans were amended before merge, and both amendments prevented wasted implement budget.

**#4007** had an unfalsifiable AC5 — it asserted only absences (socket untouched, no rollback mark, no rebind log), every one trivially true against pre-fix code that has no watch at all. Reworded to assert the observed tick. AC7 asked for a new pure predicate where `daemon.ts` already exports `fallbackVerdict` and `isHandoffStillPending`, which together *are* the watch-tick decision; now says reuse or extend.

**#4008** had two substantive gaps. The gate needs each sibling row's `owner_identity`, but `RUN_COLUMNS` does not select it and the exported `Run` type has no such field — it is on `Pipeline`. The spec asserted persistence was unchanged, which would have dropped the implementer into undeclared scope on contact. It also exempted `adoptAndSettlePipelineStage` by asserting every non-sweep caller dispatches its own run; that function's own doc comment says the opposite — it adopts a pre-existing run and settles with `isEntryRunLive ?? (() => false)`, the same re-entry shape the sweep guards. Left alone, the fix would have shipped with a second un-gated path carrying the identical bug.

Worth noting in the other direction: #4008's drafter **corrected its own intent**, which claimed the failure rolls up `killed` / `resumable_kill`. That is wrong against `main`, and the draft restated the real failure mode.

## Harness behavior observed

**`pipeline_no_live_owner` is honest and self-resolving.** Approving a gate was refused after this session's source merges rotated the daemon digest and the owning generation was still draining a live lane. `list` showed the gate throughout. The same command succeeded unchanged once the lane settled — no `daemon start`, no kill. The cost is operator latency, not lost work. It is also a reminder that the runbook's own rule (while lanes are live, restrict yourself to docs- and spec-only merges) is the cheap avoidance, and both merges that caused it were source merges made with a lane in flight.

**A stage settled `failed` against a live run.** Lane 2's implement stage settled `resumable_kill` / `entryRunStatus: killed` while its linked run was still working; that run then read `completed` with attempts `progress, progress, done`. Sharper than the orphan case — not a stage failing to notice a recovery, but a stage declaring failure against a live run. Likely triggered by the self-handoff reconciling non-terminal rows mid-flight.

**Stage orphaning after `run resume` is not specific to gate refusal.** A lane that settled `surviving_mutation_failed`, was hand-corrected and resumed, and published PR #4013 still left its stage `failed` with a null PR artifact. Evidence added to [[pipeline-resume-resumes-a-resumable-implement-row]] along with a criterion.

**`gate_invocation_refused` cause matters.** #4014's lane refused with `ceiling_headroom`, not `slot_contention`, with zero commits ahead of base. Slot contention clears itself; ceiling headroom does not. The cause field is what distinguishes "wait" from "re-dispatch".

## Traps that nearly produced wrong conclusions

- **The base-ref probe's own intentional fixture failures** (`fail one`, `fail two`, `Cannot find package 'probe-fixture-dep'`) are echoed into CI logs and read exactly like real failures. They appeared in three separate investigations this session.
- **`bun run check` on `main` exits 0 with 61 biome warnings.** A gate log tail dominated by `noNonNullAssertion` lines is not the failure; the failure was the dead-export guard.
- **48 test failures that were entirely sandbox `EPERM`.** A hand-finish gate run from an agent session shows them whenever a suite `mkdtemp`s under `~/.jarvis`. Outside the sandbox: 108/108.
- **`acceptedSites: []` is not the vacuous-pass signal.** `recordAcceptedSite` fires only on a `@mutate-equivalent` directive, so that field counts exemptions, not kills. The real vacuity signal is stale `skippedCandidates` — which appeared the moment I ran the verifier over uncommitted fixes, exactly as the brief warns. Commit first.
- **A branch green before a change and red after is not attribution.** #4012 red-gated twice on two different tests, neither reproducing locally, and the changed predicate provably cannot affect CI's test roster (its consumers are `scripts/guard-*` and the runtime verifiers). Third run green.

## Seeds

- **New:** `worktree-materialization-fails-on-committed-node-modules-symlink` (#4003) — `ensureExternalWorktree` never `lstat`s the link path, and the harness's own `git add -A` commits the symlink past a `node_modules/` ignore rule, poisoning the base branch for every later lane.
- **New:** `rebased-lane-cannot-publish-on-non-force-push` — found by reviewing #4014, not by a failure. Continuation rebases a lane, then `completion-publisher.ts:136` pushes non-force and `publication-retry.ts:45` classifies non-fast-forward as permanent, so an already-pushed continued lane dies at publication after a full agent run. Strictly worse than the early refusal it replaced.
- **Extended:** `gate-allowset-derivation-fails-on-external-spec-home` with #4004's empty-scope branch — an `implement-review` with no verdict patch resolves an existing-but-empty scope root, derives `undefined`, and strands a complete lane at flip-to-ready.
- **Extended:** `pipeline-resume-resumes-a-resumable-implement-row` with the non-gate-refusal recurrence.

Not seeded, one occurrence only: a spec that changes a registered prompt must also register it in `RENDER_OBSERVER_TESTS`; the plan named the render assertion but not the registration.

## Cost

Agent side, from telemetry, 18:00Z onward: **$51.38 across 64 invocations** (60 `ok`, 3 `quota`, 1 `error`). Largest lane `redispatch-continues-committed-lane` at $18.93 over 11 invocations, which absorbed a `ceiling_headroom` refusal and resume. The two quota-killed implements cost $0.00.

## Open at close

- Pipeline `a9b661d5` lane 3 (`recover-admits-landing-failed-plan-write-row`) never started; its prerequisite (#4017) is now on `main`, so it is ready to dispatch when quota returns.
- Two specs planned but not implemented: `daemon-committed-successor-watch` (#4007) and `stage-settlement-foreign-owner-liveness` (#4008). Both implements failed instantly on quota.
- Six older plan-only specs remain unimplemented, audited this session: `cleanup-archives-hand-landed-specs`, `tui-consumes-retained-pipeline-list`, `bulk-terminal-run-dismissal-cli`, `stage-success-reopens-skipped-successors`, `persist-gate-refusal-recovery-state`, `serve-canonical-failures-from-daemon`. Plus `surviving-mutation-settlement-records-killing-set`, whose subspec 00 landed via #3787 with subspec 01 outstanding.
- One worktree failed to retire: `redispatch-continues-committed-lane`, `merged PR authority no longer matches`, because I rebased that branch after its PR was created so the merged `headRefOid` no longer matches the local head. Fail-closed and correct; it needs a manual retire.
- Issues #3974 and #3949 stay open until their implementations close them. #3949's class is narrowed, not closed: a bare line *following* an authored bullet is deliberately left as a continuation and still fails `no-hard-wrap`.
