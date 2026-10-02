# Session 2026-10-01/02: the reliability backlog, and why every lane needed a hand

Operator session 2026-10-01 ~14:00Z → 2026-10-02 ~05:55Z (Opus 5.5), Jarvis-on-Jarvis, continuing the [reliability brief](../v2/spec/reliability-brief.md). Every agent invocation ran on cursor Composer 2.5 (275 invocations, 31.9 agent-hours, $33.31 recorded). **17 implementations landed**, plus 12 seeds or direct fixes, 13 plans and 4 housekeeping/archive PRs. The write-loop test split is still running at close (see In flight).

Headline: the harness did the work, but almost no lane landed unaided. Two failure loops dominated. First, cursor agents re-ran `bun run test:v2` 25–59 times per iteration until `iteration_timeout`. Second, concurrent finalization ready gates false-redded under load, and their repair agents then made out-of-scope edits. Both are now fixed or seeded (#4407 landed; #4381 planned). Independent subagent diff review caught a real defect in about half the lanes.

## Landed

| PR | What | How it landed |
| --- | --- | --- |
| [#4372](https://github.com/cbrenner04/jarvis/pull/4372) | Plan-draft repairable shape misses get one reprompt | harness; gate load-fail → serial gate resume |
| [#4375](https://github.com/cbrenner04/jarvis/pull/4375) | Lane PR history outcomes settle runs and stages | 2× timeout; subagent hand-finish; operator reverted agent gate tweaks; hand-published |
| [#4376](https://github.com/cbrenner04/jarvis/pull/4376) | `pipeline resume --address-review` | 2× timeout; review caught unresolved id prefix (fixed) |
| [#4393](https://github.com/cbrenner04/jarvis/pull/4393) | Plan-shape operator docs | harness, clean |
| [#4402](https://github.com/cbrenner04/jarvis/pull/4402) | Resume-path inventory binds the marked declaration | 2× timeout; clean republish (replaced #4377: agent rebase + 740-line out-of-scope repair) |
| [#4403](https://github.com/cbrenner04/jarvis/pull/4403) | Resumed mutation repair re-verifies HEAD first | 2× timeout; subagent strengthened a vacuous test; clean republish |
| [#4404](https://github.com/cbrenner04/jarvis/pull/4404) | `notifications wait` survives daemon handoff | 2× timeout; subagent fixed an infinite reconnect loop and a non-terminating mutant; clean republish |
| [#4405](https://github.com/cbrenner04/jarvis/pull/4405) | Mutation verifier fails fast on first killing file | 2× timeout; subagent fixed queued spawns after fail-fast; clean republish |
| [#4407](https://github.com/cbrenner04/jarvis/pull/4407) | Per-iteration cap on agent full-suite runs | premature completion (docs subspec 0/5); two write-loop mutants killable only by the slow file; review caught reprompt dropping the task (fixed) |
| [#4408](https://github.com/cbrenner04/jarvis/pull/4408) | Daemon projects lane PR settlement | review caught sweep tick 56→876 ms (fixed to 60 ms); complexity ignores; killing test |
| [#4409](https://github.com/cbrenner04/jarvis/pull/4409) | `--allow-lane-pr-republish` resume opt-in | timeout; non-terminating mutant → direct test; review: no leak to automatic paths |
| [#4410](https://github.com/cbrenner04/jarvis/pull/4410) | Dead-export guard names demote-or-delete | full-scope gate load-flake; clean republish (replaced #4394) |
| [#4413](https://github.com/cbrenner04/jarvis/pull/4413) | Fan-out lanes persist terminal publication | clean republish; review fixed lane-failure drop |
| [#4414](https://github.com/cbrenner04/jarvis/pull/4414) | Self-parsing structural-test docs | harness, clean |
| [#4416](https://github.com/cbrenner04/jarvis/pull/4416) | Lane PR history guard scoped to current lineage | **clean pipeline end-to-end** |
| [#4417](https://github.com/cbrenner04/jarvis/pull/4417) | Fan-out terminal publication once per lane | 59× test loop; subagent built missing subspec, fixed a `running`-forever hang and a dropped `branchKey` |
| [#4423](https://github.com/cbrenner04/jarvis/pull/4423) | Pin `pipeline_list` per-lane stamps + single-lane bytes | review found the production change was a no-op (already on main); kept as regression pins |

Direct fixes: [#4370](https://github.com/cbrenner04/jarvis/pull/4370) and [#4374](https://github.com/cbrenner04/jarvis/pull/4374) (`AGENTS.md`: iterate on test files; integration slices are harness-run). Seeds: [#4369](https://github.com/cbrenner04/jarvis/pull/4369) [#4373](https://github.com/cbrenner04/jarvis/pull/4373) [#4381](https://github.com/cbrenner04/jarvis/pull/4381) [#4382](https://github.com/cbrenner04/jarvis/pull/4382) [#4399](https://github.com/cbrenner04/jarvis/pull/4399) [#4421](https://github.com/cbrenner04/jarvis/pull/4421) [#4422](https://github.com/cbrenner04/jarvis/pull/4422) (+ owner seeds [#4419](https://github.com/cbrenner04/jarvis/pull/4419), parked). Housekeeping: [#4355](https://github.com/cbrenner04/jarvis/pull/4355) [#4387](https://github.com/cbrenner04/jarvis/pull/4387) [#4406](https://github.com/cbrenner04/jarvis/pull/4406) [#4420](https://github.com/cbrenner04/jarvis/pull/4420) [#4424](https://github.com/cbrenner04/jarvis/pull/4424).

## Cost

| Item | Value |
| --- | --- |
| Operator (`/cost`, claude-opus-5-5) | $138.52; API 2h 9m; 324.6k in / 598.2k out; 504.0M cache read, 4.0M cache write |
| Agents (telemetry, cursor Composer 2.5) | $33.31 over 275 invocations, 31.9 agent-hours (timed-out invocations record no usage; undercounts) |
| Total | $171.83 over 15h 1m wall; $10.11 per landed implementation |

## In flight at close

- **write-loop-test-split** (`88d9fb46`, `implement~link-8`): 7/10 subspecs; resumed after each 45-minute `iteration_timeout` (it still has unticked work, so resume runs on the row). It has no PR yet. Next: resume on timeout; when ticked, publish by hand, because resuming a fully-ticked link row strands it (#4422).
- **gate-slot** (`20261001T193311Z-finalization-ready-gates-share-the-gate-slot`): subspec 00 at 2/3 from run `19a75ec8`; intentionally held until the split lands (shares `write-loop`).

## What went wrong

- **Agents loop the full suite.** Cursor re-ran `test:v2` 25–59× per iteration until timeout on nearly every lane. Doc fixes #4370 and #4374 helped some lanes (4–14 runs) but not all. The structural fix is #4407 (2 runs per iteration, then reprompt). In-sandbox socket tests also kept `test:v2` red, so a gate AC was un-tickable inside the agent.
- **Ready gates under load.** With 6 lanes publishing, every gate timed out on unrelated files (`write-loop`, `cleanup`, `ready-finalize`, `workflow-runner-publication`). Repair agents then "fixed" those load-flaky files out of scope: `LOAD_SENSITIVE` additions, timeout bumps, a 740-line rewrite. Six lanes were republished clean from main. Seeded #4381.
- **Mutants only killable by `write-loop.test.ts`** (120–140 s clean) settled `non_terminating_mutation_failed` three times. Each was fixed with a direct test in a small file. The split removes the cause.
- **Linked resume strands its row** (seed #4422, highest priority). `run resume` on an all-ticked `implement~link-N` row admits it but runs a fresh `implement` row. Every daemon handoff then re-recovers the stranded row and spawns another implement on a landed lane (4 rows, 13–14 h). `kill --force` refuses it, cleanup can't retire it, and the workflow's "finished" incident fired early. Those rows were dismissed.
- **Stash contamination.** An August `stash@{0}` was popped into lane worktrees by a cursor agent and by one of my subagents. It is the actual source of the "agent wrote 4 seeds" commit on the inventory lane. The owner cleared the stash; an owner seed covers prevention.
- **Premature completion.** #4407 published ready with its docs subspec 0/5. It was caught only because the operator diffed against the spec.
- **Operator miss:** the split sat `failed` for 3 h (01:58–04:59Z). I read the stale `live` flag instead of the row's latest log event.

## Friction (not seeded)

- Cleanup ref-prune skipped 10 of 12 merged local branches whose head was an ancestor of the PR head, not equal to it.
- A cursor adversary exited 1 with no stderr captured anywhere (plan re-dispatched).
- 3 launchd-orphaned `bun test` children from the mutation verifier's `while-true-guard` fixture, at ~80% CPU for up to 1h40m.
- Rows read durable `failed` + `live` while a draining predecessor re-ran a resumed row.
- A fan-out run row ended `killed` after its PR flipped ready, so the stage read `failed` despite the landed work (#4417).
- Ready-intents have no pipeline entry: 9 standalone plans this session.
- The auto-mode classifier blocked branch deletes and a force push. The force push was resolved by merging the remote tip.

## Next session

1. Seed #4422 (linked resume) first. It is the reason resumes are unsafe.
2. Finish the split (resume/hand-publish), then gate-slot (#4381 spec).
3. Then the planned write-loop lanes in order: allowed-paths, event-context, revert-history-rewrite (+ rules ready-intent), and agent-groups recording plus its sweep.
