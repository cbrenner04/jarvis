# Fan-out is a consumption race, not a ceiling

Operator session, 2026-09-07. Brief: continue the structural recovery, dogfood pipelines, and push parallelization at every workflow stage. Agent order `codex, cursor, claude` by operator instruction.

**17 PRs merged, zero open at close. Five P0s closed.**

## The headline: fan-out already parallelizes

The brief carried this as a P0: *"A fan-out pipeline can never advance a second lane."* Three sessions read that and drove every dependent lane standalone.

It is too strong. Plan-stage resolution verifies the whole `downstreamInputs` list, but a path only fails verification once it has been `git mv`'d into a spec tree. So the failure needs a **consumed sibling** — and the serial *"head lane first, land, then resume"* practice the brief and runbook both prescribed is exactly what creates that state.

Approving **every** `approve-intent` gate back to back, before any sibling plan lands, dispatches all lanes in parallel. Verified on two independent pipelines, four concurrent plan stages:

| Pipeline | Lanes dispatched concurrently |
| --- | --- |
| `623746e6` | `cleanup-pr-ownership-probe-fails-closed` + `pipeline-never-landed-probe-fails-closed` |
| `0c6f19d6` | `make-run-kill-rpc-report-settlement` + `render-run-kill-settlement-outcomes` |

Three consequences: it is a **working workaround today**; fan-out plan stages **already parallelize**, so the fix restores a capability rather than building one; and the bug is reachable *only* through consumed siblings, so a regression test that approves two fresh gates passes against current code and proves nothing. The seed's existing first AC already got this right.

Corrected in [#3565](https://github.com/cbrenner04/jarvis/pull/3565); fixed the same day in [#3575](https://github.com/cbrenner04/jarvis/pull/3575), which landed with a named test for the consumed-sibling case.

**Honest limit:** simultaneous approval fixes *resolution*. Hard-coupled lanes then block at plan with accurate `## Blocker` text naming unmerged prerequisites — correct behavior, and still [[plan-bases-off-a-declared-prerequisite-branch]].

## Parallelization: four concurrent implements ran clean, but the ceiling was not tested

Four concurrent implement stages, ~68 minutes, **zero** `iteration_timeout`, zero watchdog kills, load never above 13.

The caveat matters more than the result. Telemetry shows the write steps were short — 35s, 198s, 201s. The wall clock went to review roles and gates, not to a write step burning its iteration budget on the full suite. So this confirms **lane count is not the ceiling** and clears four concurrent pipeline implement stages on small specs. It does **not** clear four heavy `shared/**` lanes; keep those at two until [[implement-gate-invocation-outlives-the-iteration-ceiling]] ships.

## New defects

**[[ready-gate-autofix-strands-on-unfixable-lint]] — stranded two of three implement lanes.** `runBuiltInReadyGateAutofixBiome` (`write-loop.ts:3300-3330`) converts any non-timeout non-zero biome exit into `FixCommandError`. `biome check --write --unsafe` exits non-zero on a diagnostic it cannot fix, and `noExcessiveCognitiveComplexity` / `noNonNullAssertion` never are — so autofix can never succeed on a diff containing one. It settles `completion_commit_failed`, and `run resume` re-enters the same autofix and fails identically. `d0923511`'s resume consumed **0 iterations** and re-settled the identical error.

The sibling is already fixed one file away: `runCompletionFormat` (`completion-commit.ts:88-102`) swallows this exact case, with a comment naming the same failure mode. The fix landed in one path and not its mirror.

**[[pipeline-list-prints-an-id-no-verb-accepts]].** The human listing renders `pipelineId.slice(0, 8)` (`v2/src/commands/pipeline.ts:462`); every sibling verb rejects it as `pipeline_not_found` — indistinguishable from a pipeline that is genuinely gone. Cost two failed commands and a JSON-parsing workaround.

## Prompt corpus leaks jarvis paths onto nine non-jarvis projects

The sweep [[implement-respects-target-repo-doc-layout]]'s third decision asked for, run across all 43 prompts. Three severities:

1. **Guidance lost, not mislocated.** `prompts/intent/split.md:29` says *"Read `v2/docs/spec-guidance-agent-core.md`"*, but `buildIntentSplitPrompt` (`shared/prompts/intent-split.ts:53`) declares only `WORKDIR`/`SEED_LABEL`/`SEED_CONTENT`. Its sibling steps — `plan-draft`, `review-plan`, `review-intent` — all inject that same file's content via `readSpecGuidance()` from the **harness install dir**, so they work on any target. Intent split is the lone step that asks the agent to fetch what the others are handed, so off-jarvis the sizing rule is simply never applied.
2. **A global fragment on every workflow.** `prompts/global/documentation.md:9` names `v2/docs/documentation-standard.md`, `behavior: global`, `order: 0`, injected nowhere. Likely the direct cause of #3426 (a `v2/docs/v1-behaviors.md` created inside a Vite SPA).
3. **Jarvis's slice layout as fact.** `prompts/plan/draft.md:57` names `bun run test:v2`, "the v1 pair", "all six for `shared/**`".

`prompts/patch/rules.md:27,29` is the correctly-parameterized counter-example: *"Use commands from target repo `AGENTS.md`"*, naming no scripts.

## Confirmations of existing seeds

- **The notification wake path is a fixed point even without `--since`.** [[notification-delivery-cursor-is-exclusive]] records the cursor case; observed here that **bare** `jarvis notifications wait` returns the identical incident (same `incidentId`, same `deliveryCursor`) on consecutive calls. There is no working push wake path at all. The one incident it produced was `run-ad-hoc-terminal` for a still-live workflow — fourth session of evidence for [[notification-incidents-roll-up-to-the-invocation]].
- **[[pipeline-cli-discovers-daemons-like-run-list]], textbook.** After 17 merges rotated the digest: `pipeline list` → `connect ENOENT …daemon-36f09eddf5207a6b.sock`, `daemon status` → `stopped`, while daemon PID 14368 had served `daemon-bc6575b435d55da6.sock` healthily for 7h19m.
- **[[coscheduled-test-pair-strands-runs-terminally]] stranded a complete P0 lane.** [#3569](https://github.com/cbrenner04/jarvis/pull/3569) (22/22 AC) settled `ready_gate_out_of_scope` / `resumable: false` / `stop`, claiming `state-store.test.ts` "also reproduces on main". On an idle machine: **159/159 on both refs**. The base-ref probe flaked the exact test it was checking.
- **Pipeline settlement wedge.** All five pipelines sat `running` with zero live runs, `settlement_deferred` / `entry_run_still_live`. The daemon-restart continuation sweep did **not** clear them; one unscoped `pipeline resume` each settled them honestly to `failed` — the documented no-marker rollup shape.

## Verified *not* a defect

Review `verdict-*.md` sidecars appearing in implement PRs: **763** are committed on `main` and `.markdownlint-cli2.jsonc` explicitly ignores `**/verdict-*.md`. Deliberate audit-trail retention. Checked before seeding.

## Operator errors

**~4h25m idle across two windows** — the dominant cost of the session, well above anything the harness cost. Root cause was mine: `pipeline wait` is single-shot, it returns once at the first boundary, and I treated it as a subscription. Having diagnosed the push wake path as broken in the first ten minutes, I kept depending on a wake path anyway instead of building a self-re-arming fallback.

**Merged four plan PRs while lanes were live**, conflicting every one of those lanes (~1h of resolution). All were spec-tree add/add and recoverable — each conflicted file verified ticks-only different before resolving — but the runbook rule exists for exactly this. Two conflicts were genuinely dangerous: `v1-behaviors.md` and `cleanup.ts`, where two lanes edited the same paragraph and the same function ([#3574](https://github.com/cbrenner04/jarvis/pull/3574) adding the `gh`-unreachable clause, the dead-daemon lane renaming socket→daemon-artifact reaping). Taking either side silently drops real work; both were combined and asserted.

**Skipped `bun run check` locally on [#3578](https://github.com/cbrenner04/jarvis/pull/3578)**, which went red on CI. Typecheck plus `lint:md` is not the gate. The error output actively misleads: twelve prominent `noNonNullAssertion` lines were all *warnings* (`biome.json` sets that rule to `warn`), while the real errors were import ordering plus one `noExcessiveCognitiveComplexity`. Also noted: `biome check --write` rewrote an unrelated file's regex, the same out-of-diff shape the repair fence exists to catch — reverted.

## Landed

P0 fixes: [#3574](https://github.com/cbrenner04/jarvis/pull/3574) pr-probe destruction guard (all three call sites verified to refuse on `unknown`), [#3575](https://github.com/cbrenner04/jarvis/pull/3575) fan-out resolution, [#3578](https://github.com/cbrenner04/jarvis/pull/3578) verifier hang (`MAX_KILLING_TEST_MS` bound plus a mutant sidecar so a killed mutant's inverted guard is restored), [#3569](https://github.com/cbrenner04/jarvis/pull/3569) canonical settlement seam.

Cleanup slices [#3576](https://github.com/cbrenner04/jarvis/pull/3576), [#3577](https://github.com/cbrenner04/jarvis/pull/3577) — the latter reaped 55 expired session logs and 23MB on its first run after merging. Plans [#3570](https://github.com/cbrenner04/jarvis/pull/3570)-[#3573](https://github.com/cbrenner04/jarvis/pull/3573); intents [#3562](https://github.com/cbrenner04/jarvis/pull/3562)-[#3564](https://github.com/cbrenner04/jarvis/pull/3564), [#3566](https://github.com/cbrenner04/jarvis/pull/3566)-[#3568](https://github.com/cbrenner04/jarvis/pull/3568); seeds and correction [#3565](https://github.com/cbrenner04/jarvis/pull/3565).

## Agents

207 invocations. Codex exhausted mid-session — **29 ok / 89 quota** — so after roughly the first hour every role paid a 2-5s codex failure before falling through to cursor, which did 89 successful invocations. Claude was never reached. Estimated agent API cost (list price; all rungs are subscriptions) **$26.62**.

## Late session (after the report was first written)

**The daemon was killed as a suspected leaked test worker, and the recovery is instructive.** A 90-minute `bun` process was killed to free CPU; it was the daemon. Its abrupt death left the bound socket behind, so every later `daemon start` failed `EADDRINUSE` — and because `run list` and `pipeline list` both route through that socket, monitoring read `live=0` while five lanes were mid-flight. `jarvis cleanup` did **not** reap this socket (it reported the daemon unreachable and moved on), so the documented recovery from the prior session did not apply; removing the socket file directly did. Startup reconciliation then settled all five lanes `killed` / `resumable_kill` / `retryable: true`, and all four resumed lanes completed and published. One orphaned `cursor-agent` (16 minutes, still writing into a worktree with no daemon to commit it) had to be terminated first, or it would have raced the resumed run on the same files.

Operational note worth keeping: in `ps`, the daemon is indistinguishable from a leaked `bun test` worker. The leaked ones are `launchd`-parented; check parentage before killing a long-lived `bun`.

**#2996 reproduced live, from an ordinary daemon death.** The re-driven diagnosability pipeline was left `interrupted`, and `pipeline resume` refused it `pipeline_not_resumable` — the exact path verified by reading `resumeDeferredRefusalApplies` (`pipeline-execution.ts:225`) an hour earlier. This widens the issue's trigger beyond "operator-killed": any daemon death during a stage produces an unrecoverable pipeline. Recovery was dismiss + abandon the worktree + restart the pipeline.

**Two issues verified still open despite the ledger implying coverage.** The ledger records #2996 and #3030 as "absorbed into the settlement seed", and that seed landed tonight as [#3569](https://github.com/cbrenner04/jarvis/pull/3569) without touching either behavior: `reconciliationTerminalStatus` (`daemon.ts:125`) still returns `killed` for any non-terminal status, so a `paused` resumable run is still flipped (#3030); and resume still refuses `interrupted` (#2996). Same shape as the completed-archive trap — a tracking doc implying coverage the code does not have. **None of the 22 open issues could be closed.**

**Queue hygiene.** 154 terminal `jarvis` run rows dismissed (list went from ~200 to 4), scoped by `--project jarvis` and verified to exclude both live rows — a `sudoku` project lane was running on the same daemon. All pipelines dismissed except the live one.

**A third plan-contract false positive, and the class recorded.** `INDEX_LINK_PATTERN` (`publication-landing.ts:45`) anchors `$` at a subspec link's closing paren, so a `(after 00 and 03)` annotation made a linked subspec read as absent and blocked publication three times. Seeded [[index-link-check-rejects-annotated-subspec-lines]]; plan hand-landed [#3584](https://github.com/cbrenner04/jarvis/pull/3584). Recorded in the brief as one class rather than a fourth regex fix ([#3586](https://github.com/cbrenner04/jarvis/pull/3586)), and generalized into [[harness-failures-must-be-falsifiable-without-source]] ([#3587](https://github.com/cbrenner04/jarvis/pull/3587)) after the operator's point that external-project operators cannot read `v2/src` — every one of tonight's expensive diagnoses required exactly that. Scope was widened from the plan-contract family to one shared failure record across every workflow and pipeline stage, since intent/plan/implement all settle through the same run-row and `failureDetail` seams.

**Also landed late:** [#3583](https://github.com/cbrenner04/jarvis/pull/3583) daemon structural-invariant anchors (27/27 AC, hand-published after the lane completed without publishing), [#3589](https://github.com/cbrenner04/jarvis/pull/3589) verifier process-group persistence (the `run-kill` P0 chain head — a child table backfilled on open, no numbered migration, so no parallel-branch collision), [#3590](https://github.com/cbrenner04/jarvis/pull/3590) cleanup reclaims terminal worktrees, and plan/seed PRs [#3579](https://github.com/cbrenner04/jarvis/pull/3579), [#3580](https://github.com/cbrenner04/jarvis/pull/3580), [#3585](https://github.com/cbrenner04/jarvis/pull/3585).

**Stale plan worktrees were the session's most repeated friction** — six `cleanup --yes --abandon` calls, every one a plan worktree pinned at an older `main` refusing redispatch. Implement auto-resets this; plan does not. Worth seeding if it recurs.

**No light-review pipeline exists.** The registry holds only `full-review` (debate on plan and implement) and `fast` (no gates). The `full-light-review-pipeline` seed specifies the gated-but-light middle tier and remains parked at P3; the operator's decision this session is that jarvis stays on `full-review`.

## Open at close — pick up here

**Pipeline `127bdc64` (`full-review`) is parked at `approve-intent` with four lanes awaiting approval.** Its intent stage succeeded and landed; nothing is running. The seed is [[harness-failures-must-be-falsifiable-without-source]], and the split is the cross-cutting decomposition the widened scope asked for:

- `persist-operator-failure-records` — durable storage for the structured record
- `serve-canonical-failures-from-daemon` — daemon-side canonical source
- `render-operator-failures-consistently` — one formatter for `run list` / `run wait` / `pipeline list` / TUI
- `settle-workflows-with-falsifiable-failures` — adoption at intent/plan/implement settlement

**Approve all four gates before any sibling plan lands** — that is this session's own finding, and approving them serially is what manufactures [[fan-out-plan-resolution-is-all-or-nothing-across-lanes]] (fixed in [#3575](https://github.com/cbrenner04/jarvis/pull/3575), but the practice still matters for coupled lanes). Read the ready-intents first: `persist-…` looks like the chain head, and the other three likely declare it as a prerequisite, in which case the head lands first and the rest follow — the same shape as the verifier chain this session, where picking the wrong head cost one dispatch.

**Also open:** [#3588](https://github.com/cbrenner04/jarvis/pull/3588) (`generalize-production-test-seam-guard`) is CI-only red — green locally on `check`, typecheck, the guard itself, and both its test files, with `main` merged in. If its current CI run also fails, the runbook's guidance for CI-only bugs is abandon and re-dispatch fresh rather than another feedback loop.
