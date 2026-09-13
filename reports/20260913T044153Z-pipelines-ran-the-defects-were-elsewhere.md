# 2026-09-13 — the pipelines ran; the defects were everywhere else

Operator session. Mandate: dogfood pipelines end to end, experiment with parallelization at every stage, keep the seed ledger current, and start from a clean state.

## Headline

**Pipelines are no longer the bottleneck.** Three `full-review` pipelines were driven seed → intent → plan → implement → PR. Intent stages are effectively free (3/3 in 3–7 minutes, no contention). Plan stages fan out cleanly at four concurrent and produced the best drafts of any session so far — **zero drafter drift**, the orphaned-renamed-subspec shape that taxed 3/3 plan lanes in each of the last two sessions did not appear once. Every remaining cost this session came from harness defects the pipeline surfaced, not from the pipeline.

What actually gated throughput, in order of expense:

1. A regression in the stable-socket lane that killed **every** pipeline control verb (found, fixed, merged, verified live in-session).
2. Two independent fixed-deadline/timeout defects that strand complete, green work.
3. The gate-slot ceiling, which is now cheap to hit and no longer destructive.

## The blocker, and what it cost

`jarvis pipeline approve` refused `pipeline_owner_conflict: … claimed by multiple daemons` with **one** daemon on the machine. After [#3806](https://github.com/cbrenner04/jarvis/pull/3806) a daemon binds both the stable public socket and its digest-keyed private endpoint; client discovery unions both; `resolvePipelineDaemonFromSocketPaths` deduped owner witnesses by **socket path**, so one daemon answering twice read as two claimants. Every verb — `approve`, `reject`, `resume`, `recover`, `wait`, `dismiss` — was dead on any live pipeline, with three pipelines stalled at gates.

Fixed in [#3818](https://github.com/cbrenner04/jarvis/pull/3818) by putting the daemon's own `ownerIdentity` on the `pipeline_owner` wire and counting distinct claimants by it, with an unidentified peer falling back to socket path so genuine two-daemon conflicts are unchanged. Verified live after the bounce: the next `approve` succeeded first try.

Two lessons. **The refusal message was actively misleading** — it names two socket paths and prescribes "manual investigation," which reads as the two-daemon shape whose documented recoveries are destructive. One `ps` and one `lsof` settled it. And **a lane that widens a daemon's addressing must audit every caller that counts sockets**: `run list`, `cleanup`, and prefix resolution all union the same discovery set, which is why [[connect-operator-clients-to-stable-daemon]] exists as its own lane.

It also exposed a process trap: the fix could not take effect without a daemon restart, the agent is blocked from restarting, and `daemon start` is refused while the incumbent holds the public address. A merged fix for a total-blocker sat inert until the operator bounced by hand. That is the whole argument for the new sixth daemon lane.

## Three defects that strand complete, green work

**`render-observer-timeout` is a fixed deadline that #3650 missed.** [#3650](https://github.com/cbrenner04/jarvis/pull/3650) gave the killing-test path a baseline-derived budget; `verifyPromptRenderCoverage` calls `runScopedTests` with **no options**, so it still gets `MAX_KILLING_TEST_MS` (30 s). The spec's own acceptance criterion required mapping its new prompt to `write-loop.test.ts`, which runs **35.67 s** — so satisfying the criterion is what guarantees the timeout. Reproduces on an idle machine; `nextAction: resume` replays the same verification, making it a fixed point on work that was 11/11 complete with a clean tree. Seeded and merged: [#3833](https://github.com/cbrenner04/jarvis/pull/3833).

**`daemon status` reports `stopped` for a healthy daemon under load.** `getDaemonStatus` uses a one-second `health` probe and `probeSocket` collapses timeout, connect error and ENOENT into `false` → `stopped`. Caught flapping running/stopped/running across three consecutive calls at 95.7% CPU while `run list` and `pipeline list` answered normally. `stopped` is the word whose documented recoveries are `kill -9` and starting a second daemon, on a daemon shared by every project. The careful classifier already exists in this codebase (`classifyDaemonSocketForCleanup` treats timeout-class as inconclusive); status does not use it. Seeded and merged: [#3832](https://github.com/cbrenner04/jarvis/pull/3832).

**Owner liveness depends on two processes agreeing about a timezone-less timestamp.** `readProcessStartEpoch` parses `ps -o lstart=` — which carries no zone — in the *reading* process's zone, and `isOwnerAlive` treats a mismatch as proof of death, after which reconciliation settles that owner's live runs `killed`. Under `bun test` Bun resolves the zone to UTC while `ps` renders system-local, so a run admitted by a test process records an epoch one UTC offset early. This cost an hour: two daemon tests failed and were diagnosed as broken drain-observer wiring twice before the zone was found. Seeded and merged: [#3825](https://github.com/cbrenner04/jarvis/pull/3825), with a runbook gotcha so the next operator re-runs with the zone aligned instead of chasing the wiring.

## Parallelization, measured

Five concurrent implement lanes were run deliberately. **Three of five hit contention:**

| Lane | Outcome |
| --- | --- |
| `guard-flip` | published, then stranded `ready_gate_out_of_scope` — load-manufactured |
| `publication-resolves-open-draft-pr` | `gate_invocation_refused` / `slot_contention` → resumed |
| `workflow-write-step-settles` | `gate_invocation_refused` / `slot_contention` |
| `linked-implement-finalization` | clean |
| `plan-draft-contract-miss-reprompt` | render-observer deadline (above) |

Two findings correct the brief:

- **The refusal is no longer destructive.** The brief records that `gate_invocation_refused` "aborts *before* the iteration's checkpoint commit — so a lane refused four times produced zero commits." The log now shows `iteration_commit` (real sha) at seq 2 and `boundary_committed` at seq 3, with a clean worktree. [#3812](https://github.com/cbrenner04/jarvis/pull/3812) fixed it. The treadmill still exists — nothing re-drives the refusal — but the cost is a parked lane, not lost work.
- **[#3804](https://github.com/cbrenner04/jarvis/pull/3804)'s cause classification works**, first live observation: `gateRefusalCause: "slot_contention"`, not `ceiling_headroom`. That distinction matters operationally — slot contention clears on its own, ceiling headroom does not, and resuming into the latter refuses again.

The expensive failure is the third one. `ready_gate_out_of_scope` named `daemon-test-lifecycle.sandbox-unrunnable.test.ts` and claimed it "also reproduces on main" — true only because the base-ref probe ran on the same saturated machine. That file is **3/3 green in both timezones** on a quiet box. So a healthy lane's load flake was classified as pre-existing and stranded with `nextAction: stop`, no resume path. Exactly the hazard the brief documents, and a direct cost of over-parallelising.

**Working number: three concurrent implements.** Not because lanes die at four or five, but because the marginal lane mostly buys refusals plus one non-recoverable load-flake verdict. `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1` is worth knowing as *conservative, not measured*: the spec derives the try-acquire-don't-queue **shape** carefully, but the value itself rests on "two full suites are compute-bound" plus observed deaths at 2–3 concurrent. Nobody compared 1 against 2. Operator decision this session: leave it.

## Review kept earning its place — three for three

Every implement reviewed independently turned up something all mechanical gates passed.

**A live prompt-injection hole.** The draft-contract reprompt wraps the contract id and detail in `<<<..._DATA_BEGIN/END>>>` markers; `write.ts` substituted both raw. The detail is `errorMessage()` from the normalizer, which embeds **agent-authored filenames**, so a staged file named with an end marker closes the data region and the rest lands as instruction text. The test claiming to cover it used that exact payload and passed anyway — it asserted `toContain(detail)` and two static template lines, never containment between the markers. The only shipped mitigation was the template asking the model not to obey embedded instructions. Fixed with real neutralization plus a containment assertion, verified falsifiable.

**Two criteria ticked on tests that could not discriminate their own fix.** On the guard-flip lane, `collapses double negation to one guard candidate` asserted only candidate count and mutated bytes — both identical under the *deleted* regex. And `respects line-scoped guard admission boundaries` genuinely cannot discriminate: every sub-case derives identically pre-fix. The first was repaired to assert the derived span; the second's criterion was corrected to stop claiming falsifiability it never had, rather than faking it.

**One real defect.** Collapsing a `!!` chain returned outright, abandoning the whole operand subtree, so `!!foo(!bar)` silently dropped `!bar` — an independent guard with nothing to do with the outer toggle. Silent mutation-coverage loss, no test, undocumented.

Note this held even on a lane that had its own `review-debate` pass. The harness's review step is not a substitute for reading the diff.

## Operator-visible friction worth fixing

- **A background watcher built on `jarvis` CLI polling is silently blind.** Two monitors ran `pipeline list` / `run list` in a sandboxed shell, where socket commands false-negative; every poll returned empty, so the diff was always empty and they sat quiet while three gates went unapproved. Empty output is indistinguishable from "nothing changed." The fix is the daemon's own sink: `tail -F ~/.jarvis/notifications.jsonl` is plain file I/O and cannot be blinded this way. Added to the operator opening prompt.
- **`jarvis daemon stop` is blocked by the auto-mode classifier**, so the agent cannot apply a merged daemon fix. This is the process half of the staleness problem the new sixth lane addresses.

## Queue

Seeds 42 → 40 (three reaped by their intent PRs, plus new ones added). Ready-intents 11 → 16. Issues 18 → 17: **#3374 closed** after verifying both halves in source — `locateExternalReadyIntentDownstreamInput` resolves a chained plan stage's ready-intent from the external specs home with three containment checks, and `stage-failed` incidents close the silent-lane half. #3041, #3040, #3439 and #3433 triaged; #3433 additionally seeded ([#3815](https://github.com/cbrenner04/jarvis/pull/3815)) after confirming preflight gate 2 still skips every out-of-root spec tree.

## Merged

[#3815](https://github.com/cbrenner04/jarvis/pull/3815), [#3818](https://github.com/cbrenner04/jarvis/pull/3818), [#3819](https://github.com/cbrenner04/jarvis/pull/3819), [#3820](https://github.com/cbrenner04/jarvis/pull/3820), [#3821](https://github.com/cbrenner04/jarvis/pull/3821), [#3822](https://github.com/cbrenner04/jarvis/pull/3822), [#3823](https://github.com/cbrenner04/jarvis/pull/3823), [#3824](https://github.com/cbrenner04/jarvis/pull/3824), [#3825](https://github.com/cbrenner04/jarvis/pull/3825), [#3831](https://github.com/cbrenner04/jarvis/pull/3831), [#3832](https://github.com/cbrenner04/jarvis/pull/3832), [#3833](https://github.com/cbrenner04/jarvis/pull/3833), plus intent PRs [#3814](https://github.com/cbrenner04/jarvis/pull/3814), [#3816](https://github.com/cbrenner04/jarvis/pull/3816), [#3817](https://github.com/cbrenner04/jarvis/pull/3817).

Implement PRs from the pipelines: [#3834](https://github.com/cbrenner04/jarvis/pull/3834) (guard-flip), [#3835](https://github.com/cbrenner04/jarvis/pull/3835) (publication-resolves-open-draft-pr), [#3836](https://github.com/cbrenner04/jarvis/pull/3836) (linked-implement-finalization), [#3838](https://github.com/cbrenner04/jarvis/pull/3838) (plan-draft-contract-miss, hand-finished). Seed [#3837](https://github.com/cbrenner04/jarvis/pull/3837) carries the new daemon lane and the priority update.
