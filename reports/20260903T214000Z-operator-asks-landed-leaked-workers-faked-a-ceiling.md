# 2026-09-03 session close — operator asks landed; leaked workers faked a concurrency ceiling

Operator-present continuation of [`20260903T045555Z-daemon-blocker-root-caused-refactor-chains-complete.md`](./20260903T045555Z-daemon-blocker-root-caused-refactor-chains-complete.md). **31 PRs merged, 1 closed as duplicate.** Both named operator asks landed; issue #3374 unblocked as a scope decision.

## Operator asks

| Ask | Chain | State |
| --- | --- | --- |
| Project-scoped notifications | seed → intent [#3406] → plan [#3412] → implement [#3418] (00) + [#3435] (01) | **COMPLETE.** Verified live: the daemon emits `"project":"jarvis"` and `"project":"homestead-service"` on real incidents |
| Pipeline resume preamble | seed → intent [#3407] → plans [#3414] [#3411] → implement [#3424] (00) | Subspec 00 landed; 01–02 open |
| Unblock [#3374](https://github.com/cbrenner04/jarvis/issues/3374) | seed amended [#3405] → intent [#3413] → plan [#3415] | Decomposed into 3 lanes, foundation merged |

`#3374` was folded into `all-spec-documents-external-capable` rather than point-fixed, per the issue's own triage comment: *"Point-fixing them one hop at a time is what produced the current state."* Its intent split into `admit-external-intent-and-plan-inputs` (merged), `cleanup-external-spec-home-lifecycle`, and `pipeline-external-chained-resolution` — the last naming the exact culprit, `locateAbsentWorktreeDownstreamInputReadRoot`.

## The session's dominant finding: the machine was lying, twice

**Eleven leaked `bun test --test-worker` processes at ~96% CPU each**, traced by parent PID and cwd to one `iteration_timeout`ed lane — plus a live producer, a **3h35m-old orphaned `bun run test:v1`** whose parent was `launchd`, still re-spawning `--only-failures` retry cohorts. Load sat at 20 with *one* live run on the machine. Killing the tree took load 30 → 13.

**This invalidated a conclusion I had already reported.** Mid-session I wrote that "six concurrent implements is a zero-output ceiling" from five failed implements. The cause was CPU starvation from that leak, and each new timeout leaked more workers — a compounding failure indistinguishable from a concurrency ceiling. **Lane count was never measured cleanly.** What the day does support: plans and intents are robust to load (5/5 succeeded, several at load 30, one completing while three implements died around it); implements are fragile to CPU starvation from any source.

**Second lie: four tests budgeted for an idle machine.** `completion-commit`, `ready-finalize`, `diff-derived-mutation-verifier` inherited `bunfig.toml`'s global 30s per-test timeout; `write-loop-ready-gate-reap` waited 5s for a real `bun run ready` to touch its trap marker. Under 20-way concurrency all four false-red while passing in isolation. They blocked implement `81c5b248` outright. Fixed in [#3430], budgets re-scaled *together* for the reap test so its fixture cannot self-exit before the abort and make `waitForGroupReaped` vacuous.

**Durable fix for the first:** [[daemon-start-sweeps-orphan-gate-children]] — plan [#3416], implement [#3431]. Daemon start now reaps ready-gate process groups whose owning run is not live, before IPC opens. `isOwnerAlive` was verified fail-safe (real PID probe with a start-epoch guard; anything not confirmed `ESRCH` counts as alive), so a superseded daemon's live runs are skipped.

## Gate fixes

- **[#3422] daemon test inventory blocked adding any daemon test.** It asserted merge-base title count *equals* branch title count, so a branch adding three tests failed with `missing: []`. Re-keyed to missing-only, matching the sibling resume inventory. Verified both directions: additions pass, a renamed title still fails. **Third instance of [[structural-invariants-key-on-behavior-not-incidental-structure]] (#3387) — raise its priority.**
- **[#3420] `ready_gate_command_missing` misclassified lint output.** Substring-scanned the whole transcript for `enoent`, so lint findings mentioning `ENOENT` settled complete work non-resumable with `nextAction: fix_config`. Now spawn `ENOENT` plus anchored failure lines, with `readyGateCommandMissingEvidence` persisted.
- **[#3419] 29 dead imports** from the two just-completed extraction chains, applied rule-scoped rather than via `bun run fix`. The brief's DI trap was checked: `daemon.ts` lost its whole `workflow-runner-resume.ts` value-import block, but `daemon-workflow-admission-handlers.ts` still value-imports `executeWorkflow`, so `wireWorkflowRunnerResumeDeps` still runs. **The implicit crutch has moved to that handler module.** Residue fix [#3421].

## Publication tail, again

Five implements produced complete, correct, committed work and failed to publish it. All salvaged by cherry-pick onto clean branches and hand-gated, never re-run:

| Lane | Failure | Landed as |
| --- | --- | --- |
| pipeline `970db782` implement stage | `iteration_timeout` under leak | [#3420] |
| operator-incidents 00 | `iteration_timeout` under leak | [#3418] |
| failed-plan-resume 00 | `iteration_timeout` under leak | [#3424] |
| orphan-gate-sweep | `ready_gate_out_of_scope` on the flaky test [#3430] fixed | [#3431] |
| notification-sweep 02–04 | `ready_flip_failed` — publication ready-flipped **#3396**, subspec 01's already-merged PR on the same branch | [#3434] |
| ledger 00 | cursor `exit_code:-1` after 997s | [#3432] |

`pipeline resume` was deliberately **not** used on the pipeline stage: it replays the failed stage through its write step, and stale reset would have retired the worktree and deleted the branch, destroying the commit.

**A regression caught only because a gate fix cleared the noise.** Salvage 3 (`failed-plan-resume`) carried an agent-authored ordering bug: its new operator-dirt refusal fired *before* shared stale-reset preflight, inverting the documented "landed-criteria drift before dirty reuse" contract. Had [#3422]'s false inventory red not been fixed first, "1 fail" in a file I had modified would have been attributed to the known-brittle inventory test and shipped.

## Cursor

Not quota'd. Today: **458 `ok`, 13 `error`, 1 `quota`, 1 `stall`** — and successful invocations five minutes after the failures. Two implement invocations each burned the full 45-minute iteration budget (`2700109ms`, `2700122ms`, `exit_code:-1`) producing zero file changes while streaming enough output to keep the 15-minute idle watchdog re-armed. I proposed reordering the agent order off that three-failure streak; the operator pushed back and the denominator proved them right. **Order unchanged (`cursor, claude`).** Root cause of the two spins is unexplained — a hypothesis that partial re-dispatch onto merged subspecs was to blame died when the notification-sweep lane, exactly that shape, completed cleanly.

## New seeds

- [[intent-resume-consumes-its-seed]] ([#3410]) — a `landing_failed` intent recovered with `run resume` lands its ready-intents but never deletes the seed, silently queueing a duplicate split. Isolated: the same batch's other intent took the ordinary path and consumed correctly.
- `boundary-split-emits-near-duplicate-subspecs` gained a concrete instance: a plan draft emitted `03-persistence.md` and `04-daemon.md` documenting the same section, `04` with its acceptance criterion stripped. Hand-landed corrected as [#3428].

## Notifications wake-primitive chain (started)

The `--project` filter the operator wants has nowhere to live: `notifications-filter-by-project` needs `jarvis notifications wait|list` and `--kind`, none of which exist. Seed [[notifications-wait-is-the-operator-wake-primitive]] → intent [#3427] split into ledger → daemon RPC → CLI. Ledger plan [#3428] hand-landed, subspec 00 [#3432]. Its cursor design (`deliveredAt:incidentId:transition`, shared verbatim across store, RPC, and CLI `--since`) explicitly rules out the line-offset cursor this session hand-rolled.

## Process failures

- **Merged with three lanes live and killed all three.** Two earlier merge bursts had superseded the daemon cleanly; this one *restarted* it, reconciling every non-terminal row to `killed`/`daemon_restart`. The runbook says this plainly. Damage was small by luck, not judgment.
- **Four wrong diagnoses of one failing test**, each stated with more confidence than the evidence carried: "the reap contract is broken", "bun 1.3.13 swallows the fixture loop" (an artifact of backgrounding `bun run ready` with `&` in a tool call that exited first), "it only fails in the agent sandbox" (the implement agent hit it too), before the correct one — a 5s budget on a real subprocess spawn. Every correction came from someone else's data: CI, an implement agent's blocker, a parent-PID trace.
- **Walked past the leak at session start.** The `ps` sweep showed four `daemon-entrypoint` processes and a `bun` at 16.9% CPU; I counted processes instead of tracing ownership. Several hours and five implement runs.
- **Piped `cleanup --abandon` to `/dev/null` in a loop**, hiding its failure and causing a refused dispatch.

## Costs

Operator `claude-opus-5`: **$95.45** — API 58m28s, wall 21h36m19s; 2.9k in / 212.1k out, 150.8M cache read, 1.5M cache write, 453 requests. Agent-side: **$10.79** (cursor list price, 79 jarvis invocations), not included in that figure.

For comparison, the prior session on this brief cost $157.78 for 22 work units; this one $95.45 for 31 PRs — but the honest read is that a large share of both figures went to diagnosing a machine that was lying, not to producing work.
