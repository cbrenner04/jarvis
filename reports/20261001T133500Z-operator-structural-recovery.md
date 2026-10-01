# Session 2026-10-01: iteration timeouts were the agents' own test runs

Operator session 2026-10-01 00:55Z→13:35Z (Opus 5.5), Jarvis-on-Jarvis, every agent invocation on cursor Composer 2.5. **14 fixes/implements landed**, plus 5 plan and 9 seed/intent/spec PRs; 2 of the 14 landed after the report was first written. Only 2 of the first 12 landed straight off the harness; the rest needed a hand fix or hand-finish. Headline: the `iteration_timeout` wave blamed on host load was agents self-running full suites, with killed iterations leaking test trees (fixed #4335). Review caught defects in 5 PRs the gates passed.

## Landed

| PR | What | How it landed | Agent | Agent min | Cost |
| --- | --- | --- | --- | --- | --- |
| [#4322](https://github.com/cbrenner04/jarvis/pull/4322) | Terminal publication accepts an operator-merged PR | harness + hand fix (`ready_gate_out_of_scope` under load; out-of-scope commit dropped) | cursor Composer 2.5 | 46 | $1.60 |
| [#4323](https://github.com/cbrenner04/jarvis/pull/4323) | Agent bindings recover token usage on failed settlement | harness + hand fix (out-of-scope hunk moved to #4340) | cursor Composer 2.5 | 60 | $1.56 |
| [#4326](https://github.com/cbrenner04/jarvis/pull/4326) | Daemon launches review-feedback for a pipeline stage without resuming it | harness + hand fix (dead export; missing retiring-daemon guard) | cursor Composer 2.5 | 76 | $2.24 |
| [#4328](https://github.com/cbrenner04/jarvis/pull/4328) | Attributable repair allowset ∩ frozen gate envelope | hand-finish (pipeline 62810cc3 went terminal-rejected) | cursor Composer 2.5 | 29 | $0.16 |
| [#4329](https://github.com/cbrenner04/jarvis/pull/4329) | Cleanup retires branches superseded by a merged successor PR | harness (1 `iteration_timeout`, re-dispatched) | cursor Composer 2.5 | 121 | $1.84 |
| [#4330](https://github.com/cbrenner04/jarvis/pull/4330) | Publication in-flow mutation repair | hand-finish (circuit-broken after 2 `iteration_timeout`s; review fix: revert kept wiping `.jarvis-*` sidecars) | cursor Composer 2.5 | 90 | $0.00 |
| [#4331](https://github.com/cbrenner04/jarvis/pull/4331) | Lane PR head+base history blocks duplicate draft create | harness + hand fix (`mutation_repair_exhausted` on a mutant already killed) | cursor Composer 2.5 | 122 | $1.14 |
| [#4332](https://github.com/cbrenner04/jarvis/pull/4332) | `plan.draft.shape` names its cause; accepts timestamp-named nested dir | harness + hand fix (`mutation_repair_exhausted`, same) | cursor Composer 2.5 | 117 | $1.43 |
| [#4335](https://github.com/cbrenner04/jarvis/pull/4335) | Agent abort reaps descendant process groups | harness + hand fix (2 review defects) | cursor Composer 2.5 | 19 | $0.85 |
| [#4345](https://github.com/cbrenner04/jarvis/pull/4345) | Shared locator binds a module's own inventory declaration | harness | cursor Composer 2.5 | 8 | $0.39 |
| [#4340](https://github.com/cbrenner04/jarvis/pull/4340) | Direct fix: `write-loop.test.ts` load-sensitive until the split lands | hand (split out of #4323) | operator | — | — |
| [#4347](https://github.com/cbrenner04/jarvis/pull/4347) | Direct fix: resumed workflow settlements notify again | hand | operator | — | — |
| [#4349](https://github.com/cbrenner04/jarvis/pull/4349) | TUI revision-follow respawns under one supervisor instead of nesting | harness (landed after report) | cursor Composer 2.5 | — | ≥$2.00 |
| [#4350](https://github.com/cbrenner04/jarvis/pull/4350) | Harness commits refuse main-sync content (`completion-commit-run-scope`) | harness (landed after report) | cursor Composer 2.5 | — | ≥$2.35 |

Agent min = summed invocation `duration_ms`. Cost covers implement runs only; plans are separate. #4330 shows $0.00 because its only two invocations timed out and recorded no usage.

Cost for #4349/#4350 is the at-report spend (d7947a22, db620719); final figure not recaptured.

Plans: [#4312](https://github.com/cbrenner04/jarvis/pull/4312) [#4313](https://github.com/cbrenner04/jarvis/pull/4313) [#4315](https://github.com/cbrenner04/jarvis/pull/4315) [#4343](https://github.com/cbrenner04/jarvis/pull/4343) [#4344](https://github.com/cbrenner04/jarvis/pull/4344). Seeds/intents/spec: [#4305](https://github.com/cbrenner04/jarvis/pull/4305) [#4306](https://github.com/cbrenner04/jarvis/pull/4306) [#4307](https://github.com/cbrenner04/jarvis/pull/4307) [#4319](https://github.com/cbrenner04/jarvis/pull/4319) [#4324](https://github.com/cbrenner04/jarvis/pull/4324) [#4333](https://github.com/cbrenner04/jarvis/pull/4333) [#4336](https://github.com/cbrenner04/jarvis/pull/4336) [#4339](https://github.com/cbrenner04/jarvis/pull/4339) [#4342](https://github.com/cbrenner04/jarvis/pull/4342). Closed 15 subsumed/rejected stage PRs.

## What went wrong and how it was fixed

- **`iteration_timeout` ×4 (b38babca, 3bbda89a, e6781607, cd5e5790):** at first I diagnosed host load (7 implements, load ~25, an external crossword-app job) and throttled to 3 live implements. The user challenged that diagnosis. The real cause was agents self-running long full suites, and every killed iteration leaked its test tree (55854, 69074). Seeded #4324; the head fix is [#4335](https://github.com/cbrenner04/jarvis/pull/4335), and two follow-on links are queued.
- **Missed notifications on resume:** 5 resumed runs settled (3 completed, 2 `mutation_repair_exhausted`), but `notifications wait` never woke because resumed settlements emitted no incident. Fixed by [#4347](https://github.com/cbrenner04/jarvis/pull/4347).
- **Mutation verifier:** resume-derived repair replays the stale survivor from `loop_finished` without re-verifying (`workflow-runner-resume.ts` ~2818–2854). Result: #4331 and #4332 exhausted on mutants that flip-verified tests already killed. Separately, the verifier waits on every killing-set file with no fail-fast, so a slow file (`write-loop.test.ts` ~100 s) under 4-way concurrency reads as a false `non_terminating`. Both lanes were hand-finished, both gaps seeded in #4348.
- **`plan.draft.shape` nested dir:** the drafter nested the spec dir under the stage root. The failure reported a bare reason and was excluded from the reprompt, which blocked 62810cc3. Flattened by hand, then `pipeline recover`. Seeded #4319, fixed by [#4332](https://github.com/cbrenner04/jarvis/pull/4332).
- **Ready-gate dead export (816dabdf):** after 10 iterations the only failing check was an unreferenced export, buried after 52 biome warnings. Hand-dropped the export and resumed.
- **Review defects the gates passed:**
  - #4326: no retiring-daemon guard (`daemon_superseded`).
  - #4330: mutation-repair revert deleted `.jarvis-*` sidecars.
  - #4323: an out-of-scope load-sensitive hunk.
  - #4322: an out-of-scope `workflow.test.ts` timeout commit.
  - #4335: SIGKILL escalation did not skip the harness's own ids, and abort tests had no bound, so they would hang instead of failing.

## Seeds written

- [#4319](https://github.com/cbrenner04/jarvis/pull/4319) `plan-draft-shape-names-its-failure`.
- [#4324](https://github.com/cbrenner04/jarvis/pull/4324) `agent-abort-reaps-its-process-tree`.
- [#4333](https://github.com/cbrenner04/jarvis/pull/4333) `write-loop-test-fits-file-budget`. Its 9-lane fan-out was rejected, so it became ready-intent #4336.
- [#4348](https://github.com/cbrenner04/jarvis/pull/4348) (this PR): `resume-mutation-repair-reverifies-before-repair` and `mutation-verifier-fails-fast-on-first-killing-file`, plus 10 held pipeline-chain ready-intents.

## Friction

- Cleanup ref-prune reported "merged PR authority no longer matches" after a worktree was removed (review-feedback-item-traceability).
- `pipeline list` was intermittent under load.
- A standalone `completion-commit-run-scope` plan was blocked by a stale rejected pipeline plan lane, and needed `--abandon --discard-unlanded`.
- The intent stage over-splits coupled work into chains: write-loop went 9 lanes, the TUI went to a fan-out, and both were rejected and rewritten as single ready-intents. The intent also wrote duplicate `## Prerequisites` headers (fd3b20e8).
- One lane `contract_miss` plus one rejected lane sent 62810cc3 terminal-rejected with no resume path. This is evidence for per-lane terminal settlement.
- A stage-failed notice for e024fa54 arrived while its resume was still live, which looks like premature settlement.
- `notifications wait` died with "IPC connection lost" on every daemon handoff (3×).
- The auto-mode classifier denied branch deletes and process kills, so they were handed off to the user.
- Integration was red on main too (daemon-changeover can't run in the sandbox).
- Hit the usage limit mid-session.

## Open items for next session

- Held dependents were queued as ready-intents in #4348; reject their pipeline gates: e024fa54 (3), eed3e866 (1), fd3b20e8 (2), c7fef6b6 (`implement-run-records-agent-process-groups` plan ready, then `daemon-sweeps-recorded-agent-groups`), f6d26336 (2).
- Plan `write-loop-test-split` (blocker #4350 landed).
- Seed: `notifications wait` survives daemon handoff.
- Seed: pipeline fan-out per-lane terminal settlement.
- Check that leaked test trees 55854 and 69074 were reaped.

## Cost

| | Cost | Notes |
| --- | --- | --- |
| Operator (`/cost`) | $91.64 (1h57m API, 13h35m wall) | claude-opus-5-5 |
| Agents (telemetry) | $23.65 | 204 invocations, 88 runs; cursor Composer 2.5 only (implement 111/$15.56, plan 66/$5.49, intent 27/$2.59) |
| **Total** | $115.29 | $8.24 per landed implement (14) |
