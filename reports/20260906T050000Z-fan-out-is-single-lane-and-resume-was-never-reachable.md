# Session 2026-09-06 (late) — fan-out is single-lane, and implement resume was never reachable

Operator session on the structural recovery. Agent order codex-disabled → `cursor` → `claude`; every one of 22 agent invocations was answered by cursor/Composer 2.5.

## Headline findings

Four defects root-caused in source, each with a reproducer rather than a hypothesis. Three are P0.

### 1. A fan-out pipeline can never advance a second lane ([#3522](https://github.com/cbrenner04/jarvis/pull/3522))

Both P0 dependent lanes had been sitting at `approve-intent` since the previous session. Approving each gate dispatched its plan stage, and both failed in **under 25 seconds** — no run row, no agent invocation, no cost — each naming the *head* lane's ready-intent, consumed into a spec tree when that lane planned:

```text
lane daemon-linked-run-row-resume-admission        → "downstream input …/write-sibling-step-id-matcher.md never landed"
lane pipeline-restart-discards-disposable-stage    → "downstream input …/stale-reset-disposable-lane-retirement-gates.md never landed"
```

`resolveChainedReadyIntentPaths` (`pipeline-stage-resolve.ts:344`) verifies the whole `downstreamInputs` list and returns the first failure for the entire fan-out; `resolveForDownstreamPaths` (`:368`) re-verifies with the same all-or-nothing behavior. `resolvePlanStage` (`:507`) never reads a `branchKey` — lane↔input binding is an unguarded positional index at `pipeline-execution.ts:1988`, where a short `results` array degrades to "skip" rather than erroring.

This explains why every multi-lane pipeline in this repo has needed its dependent lanes hand-driven. The failure then cascaded into [[skipped-successor-strands-a-recovered-lane]]: both lanes' `approve-plan` rows flipped `skipped`, reachable by no verb. Both lanes were driven standalone instead.

### 2. Implement resume has never been reachable ([#3536](https://github.com/cbrenner04/jarvis/pull/3536))

All three implement lanes this session timed out under load, and **not one could be resumed**. The cause is one argument:

`buildSubspecCompletionInventory` (`write-loop.ts:231`) resolves each linked subspec **inside the managed worktree**, then relativizes against **`projectRoot`**. Those always differ for a git-enabled run, so `relative()` is `../..`-prefixed, `repoRelativeSubspecPath` returns `undefined`, and every subspec hits `continue`.

Isolated against a real stranded worktree, varying only that argument:

```text
projectRoot = the managed worktree      → completed: [00], remaining: [01, 02, 03]
projectRoot = the operator's checkout   → completed: [],   remaining: []
```

`hasCompletedSubspec` is `completedSubspecPaths.length > 0`, and it gates `resumable` on `iteration_timeout`. So the always-empty inventory makes a timeout **non-resumable by construction**, and the runbook's `iteration_timeout with completed subspecs` → `jarvis run resume` recovery can never fire for an implement lane. Run `ec7cc3aa` is the sharp case: subspec 00 committed with **12/12 ACs ticked**, reported as no completed subspecs and no resume path.

This retroactively explains a large share of the "implement stranded, hand-finish it" history in the ledger.

### 3. `daemon start` cannot reclaim its own leftover socket ([#3533](https://github.com/cbrenner04/jarvis/pull/3533))

The daemon died abruptly mid-session and then **could not be restarted at all** — two attempts, both `Error: Daemon process NNNN died during startup`. The real cause, only in `~/.jarvis/daemon-<digest>.log`, was `EADDRINUSE`.

`removeStaleSocketPath` removes only on `stale`. `absent` correctly removes nothing (a sandboxed caller gets `ENOENT` for a live socket). But **`absent` and "the path is free to bind" are treated as one claim**, so an occupied path with no accepting peer skips removal and hands an unbindable path to `listen`. Measured at the wedged moment: file present, nothing bound, zero daemon processes, and a raw `connect()` returning `ECONNREFUSED` — the harness's own definition of stale.

`jarvis cleanup` classified the identical socket correctly on the first try and fixed it. Two subsystems disagree about the same path, and only one is on the startup path.

### 4. A failed `gh` probe authorizes destruction ([#3532](https://github.com/cbrenner04/jarvis/pull/3532))

`gateOnOpenPrs` (`cleanup.ts:2000-2014`) collapses "the probe failed" into "there are no PRs". Every downstream guard then reads an inconclusive answer as permissive — inverting the brief's own rule, and reachable *by default* because `gh` false-negatives under the sandbox every agent session runs in. It already silently disables `--abandon`'s "matching PR is ready (non-draft)" guard, whose entire job is protecting operator-reviewed branches, and the disposable-lane classifier now routes through it to authorize worktree destruction.

## The plan-contract gate condemns its own mandated format ([#3525](https://github.com/cbrenner04/jarvis/pull/3525))

Two `contract_miss` blocks, on two different bullet types, both false positives from the same over-broad multi-surface check.

A single-surface daemon decision was condemned by its own **required** `rules out` clause:

```text
full bullet                                                      -> [ "daemon", "execution-loop" ]
"Daemon resume admits owning write-row completion_commit_failed" -> [ "daemon" ]
"rules out write-loop re-entry"                                  -> [ "execution-loop" ]
```

Spec guidance requires every Decisions bullet to end with `rules out X`; whenever X names the surface being rejected — the normal case — the bullet is condemned for naming it. Distinct from #3383, which is the same function over-matching a bare common word (`cli` ← "flag"): that is lexical, this is structural.

The second block was an **Acceptance criteria** bullet naming both a test's home surface and the module it pins — the normal shape of a structural-invariant re-key. Scope note: the two sibling anchor lanes completed cleanly, so this is not whole-family exposure.

Both drafts were sound and were hand-landed ([#3524](https://github.com/cbrenner04/jarvis/pull/3524), [#3527](https://github.com/cbrenner04/jarvis/pull/3527)) after verifying every test and audit row they cited exists. Two hand-interventions on one gate tripped the circuit-breaker; the plan lane is off Jarvis until the fix merges.

## Gates passed work that review rejected

All three stranded lanes were salvaged, and **each carried defects all three mechanical gates missed**.

**External-chain ([#3534](https://github.com/cbrenner04/jarvis/pull/3534))** — `bun run check` was red on import ordering, so the lane could never have self-published even without the daemon loss, and the ACs had been ticked without running it. Worse, the containment gate had **zero coverage**: deleting `|| chainedStageEffectivePublishGit(...)` — accepting external paths for git-committing projects, which the ledger forbids — left all 53 tests green. Added a test, mutation-verified. Review did confirm the production path is genuinely reachable and cross-project containment is enforced *by construction*.

**Disposable-lane ([#3535](https://github.com/cbrenner04/jarvis/pull/3535))** — the instructive one. The diff silently **repurposed two pre-existing tests**: an unlanded commit injected into each and assertions flipped from `"acceptance criteria ticked"` to `"hand-finish"`, while keeping names claiming landed-criteria coverage. After it, `"not a descendant"` appeared in **zero** tests. Also: a descendant fixture that never armed its gate (it advanced the default branch while the lane's base was `intentBranch`, and asserted only that heads *differ*), and a vacuous test pinning `laneHasOpenDraftPr` — dead code, true exactly when the classifier already refuses.

My first fix was to rename the two tests. `daemon-test-inventory.test.ts` failed immediately: it pins **merge-base test titles**. That is also precisely why the original regression got through — the agent kept both titles and changed only the bodies. **The guard detects deleted coverage, not hollowed-out coverage.** Renaming was wrong; the titles and semantics were both restored, keeping each lane non-disposable via an open draft PR so the gate still applies.

**Daemon-linked ([#3538](https://github.com/cbrenner04/jarvis/pull/3538))** — clean on inspection and mutation-verified.

## Parallelization

| Shape | Load | Outcome |
| --- | --- | --- |
| 3 plans concurrent | ~12 | 2 of 3 clean end-to-end; the third blocked on content, not contention |
| 6 mixed lanes (3 implements + 3 plans) | 12-15 | zero watchdog kills, zero idle stalls |
| 3 implements in verification simultaneously | **48.8** | all three `iteration_timeout` at exactly 45.1 min |

The ceiling is not lane count — it is **verification-phase overlap**. Each diff-derived verifier spawns up to `MAX_CONCURRENT_VERIFIER_TEST_RUNS` (4) `bun test` subprocesses, so three implements is ~12 concurrent test processes plus their gates. The prior session measured four concurrent implements but evidently never had four verification phases coincide. Nothing in the harness staggers them.

All of the above ran with **two cores permanently stolen** by orphaned `bun test` processes (3h45m and 2h54m at ~93% CPU, parented to `launchd`, in worktrees whose specs had long landed) — the [[bind-verifier-spawns-to-run-termination]] mode, still actively respawning cohorts. The operator cleared them mid-session.

## Runbook rot was three times what the ledger recorded ([#3530](https://github.com/cbrenner04/jarvis/pull/3530))

The ledger said four bullets cite seeds that no longer exist. The real count is **13**, each verified against `main` rather than name-matched, because several exist to stop an operator reaching for a destructive shared `kill -9`.

Eight had shipped; their pointers were retired, with durable lessons restated where the mechanism died but the habit still pays. One was factually wrong rather than stale — the presets table described `LEGACY_WORKFLOW_ALIASES`, a symbol with zero occurrences.

**Three never shipped**, all lost to bulk backlog purges rather than to landings, and all re-seeded: `daemon-stop-refusal-checks-run-liveness` (`daemon-lifecycle.ts:212-216` still refuses on non-terminal status with no liveness check), `v1-and-v2-read-agent-order-from-different-config-keys` (`agentOrder` has zero occurrences under `v2/`+`shared/`), and `retire-claude-pool-contention-folklore` (`pool-contention.ts:100` still tells operators to pause a live session — the opposite of every measurement since).

One trap avoided: `JARVIS_READY_TIER` being stomped to `"full"` is *true* but **deliberate**, specced after a `fast` inherit shipped a lint-red PR. It was labelled a pending bug; restated as a design cost.

## Issue triage

Every open intake issue now maps to a seed, ready-intent, or active spec. #3423 was root-caused and confirmed to share a root with #3417 — `resolveSpecScopeRoot` succeeds on an external absolute `specPath`, so the graceful `scopeRoot === null` fallback is unreachable and enumeration rejects every path as `../`-prefixed, while eight distinct `undefined` returns collapse into one unlogged string. #1453, the last unseeded issue, was re-seeded and narrowed: the earlier triage recorded "only codex is sandboxed", which understates cursor's own sandbox and claude's permission mode; the real defect is that confinement is an emergent property of which quota rung answered and is recorded nowhere.

## Friction not worth seeding

- The auto-mode classifier blocks `kill` and `--reset-despite-*` flags from the operator agent, so orphan cleanup and one controlled re-dispatch had to be handed to the operator. The single-lane load re-test consequently did not happen.
- Background `sleep` waits returned early several times, causing more status polling than intended; condition-based `until` loops worked.
- `jarvis` socket commands false-negative under the sandbox, including inside `Monitor` — a lane-settlement monitor reported "all settled" instantly while five lanes were live.

## Second half: `main` does not pass its own local gate

The three specs whose subspec 00 landed were re-dispatched to finish subspecs 01+. Both lanes **completed every remaining subspec** and neither published — for two more distinct reasons.

### A co-scheduled test pair strands healthy work terminally ([#3542](https://github.com/cbrenner04/jarvis/pull/3542), amended [#3544](https://github.com/cbrenner04/jarvis/pull/3544))

`20260905T210307Z-pipeline-external-chained-resolution` settled `ready_gate_out_of_scope` with 8 commits and all 5 subspecs complete, naming two test files not in its diff. Verifying the claim naively **confirms it** — running the pair together on `main` reproduces the failures, which is exactly how the base-ref probe reaches its verdict. Only isolation separates them:

```text
workflow.test.ts alone                          → 104/104 (twice)
diff-derived-mutation-verifier.test.ts alone    → 101/101
both together                                   → 2 fail, both at exactly 5000 ms
```

At load 1.7 — so not the ambient-load shape already documented. The verifier suite spawns up to four real `bun test` subprocesses (`MAX_CONCURRENT_VERIFIER_TEST_RUNS`), starving the other file's bounded waits. The probe then re-runs the same pair, sees the same failures, correctly concludes "reproduces on base", and settles `nextAction: stop`, non-resumable.

Measuring the baseline widened it considerably: **`main` itself fails `bun run test:v2` on an idle machine** (2 failures), and a branch touching neither file fails 3 — a different cast. All five settle at exactly 30000 ms and all five pass in isolation. **The failing set rotates.** CI stays green because it scopes by changed path and never runs the full union.

Two consequences: an operator following the runbook's "run the affected test script before ticking" sees red on `main` and cannot distinguish it from their own breakage, and per-file entries in the existing `LOAD_SENSITIVE_FILES` seam (`scripts/test-slice.ts:14`) are whack-a-mole against a rotating set.

### Two false mutation pins, both inside ticked acceptance criteria

`20260906T034130Z-cli-structural-invariant-test-anchors` settled `surviving_mutation_failed` at `help-flags-parity.ts:85`. The flip-and-test check found it **genuine**: the co-located suite passed 6/6 under the mutation. Inverting the leaf guard makes `parityGuardedPaths()` return `[]`, and every existing assertion over it is `.not.toEqual(...)` or emptiness-tolerant — so `[]` satisfies them all vacuously. Fixed with a positive assertion, verified to kill the mutant, then recovered with `jarvis run resume` rather than hand-publishing.

The external-chain diff carried the mirror image: an `@mutate` annotation claiming to pin `addSuppressedInvocationForFailedStage`, where deleting the annotated line left the file green. The line looked dead — `pipelineAttributedRunIds` is built from every entry-run invocation id, so anything the suppression set covers is already excluded from `run-ad-hoc-terminal`. It is not dead: the suppression check runs **before** the `blocked` and `budget-soft-stopped` branches, which attribution does not guard. Reachable code with no test that reached it. A `blocked` sibling run under the failed lane's invocation now reaches it.

Both were in ticked ACs and both passed every mechanical gate. A `@mutate` annotation that does not kill is worse than no annotation: it asserts coverage that does not exist.

### What review confirmed was sound

Not everything was defective. On the fan-out incidents work, review verified the crux directly: per-lane `incidentId` is `stage:${pipelineId}:${stageId}:${branchKey}`, checked against a 3-lane fixture producing distinct incidents for two failed siblings. Since incidents dedupe on `(incidentId, transition)`, a shared id would have silently dropped all but one lane — the exact bug being fixed. Zero pre-existing tests were touched (`--numstat` `176 0`).

## Tally

23 PRs merged. Nine seeds filed, five P0-class, every one root-caused in source with a reproducer rather than a hypothesis: fan-out single-lane, resume-never-reachable, daemon socket wedge, `gh`-probe destruction, co-scheduled flake, plus the external-spec fence derivation, the `rules out` classifier, agent confinement, and three re-seeds recovered from the runbook sweep.

**Five distinct ways a healthy implement lane failed to publish, all in one session**: iteration timeout with an unreachable resume path, daemon death mid-run, terminal out-of-scope from a flaky pair, surviving-mutation on a genuinely uncovered guard, and — from the earlier half — a red `check` the agent never ran.

## Cost

Agent side: **48 invocations, $8.00, 4.91h**, all cursor/Composer 2.5 — 5 plan cycles (each a full adversary/advocate/adjudicator/actuator debate), 21 implement, 2 shrink. The two gate-blocked plans cost $0.56; their real cost was the hand-landing. The timed-out implements record no cost (45.1 min each, the iteration bound).

Operator side: see `reports/operator-costs.csv`.
