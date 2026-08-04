# v2 implement queue

Authority: operator priorities. Updated 2026-08-03 (late).

## Goal

**TUI slice 5 is done** (#2575). Slice 6 (steering + log) from [tui-overhaul-brief.md](tui-overhaul-brief.md) is unseeded and is the next TUI move. **Pipelines** are the other live thread: stage linkage landed (#2566), concurrent sibling dispatch is written but deadlocks intermittently (#2577, draft), and the claim seam stays blocked behind it.

## Start here next

**Fix `awaitFanOutPeerRow` on [#2577](https://github.com/cbrenner04/jarvis/pull/2577)** — draft, do not merge. Root cause of the 1-in-3 e2e hang is found and confirmed by two independent investigations:

```ts
for (;;) { …; if (record?.status !== "pending") return "stop"; await Promise.resolve(); }
```

`await Promise.resolve()` yields to **microtasks only**, so the queue never drains and timers/IO never run — 5M iterations in 114 ms with a `setTimeout(…, 0)` that never fires. Every non-leader fan-out branch parks here. New on this branch; `main` has no leader concept.

A macrotask yield alone makes the e2e file 8/8 green and was **deliberately not committed** — it cures the CPU burn but not the wait. Two deterministic deadlocks remain where the leader never dispatches the peer: leader row already `succeeded` (carries artifact forward, moves on), or `failed`/`skipped` (`advanceAuthoredStageAtIndex` returns `branch-terminal`). Both are on the daemon-restart recovery path (`recoverContinuablePipelines` → `continuePipeline` with no `continuationBranchKey`). With the yield those become silently pending pipelines under a green suite.

Real fix: a promise the leader resolves when it writes the peer's linkage — or macrotask yield **plus** bounded deadline **plus** peer self-dispatch when the leader's row is terminal. That also unblocks subspec 01's two inert pins: the serialized `@mutate` form deadlocks *because of this bug*, so fixing it makes those pins fail honestly. The Blocker's "fixtures need bounded waits to fail fast" note has cause and effect backwards — do not do that; it would hide a real product hang.

Two more to handle in the same pass: **double settlement** of each peer row (peer's own walk and the leader's `dispatchPipelineStage` both await the same `wait(entryRunId)` and write the same terminal patch — fixtures miss it because their seeded runs are already terminal), and **`Promise.all` losing sibling errors** (second rejection unhandled; a rejecting suffix walk lets `runPipeline` settle publication while a sibling keeps writing rows detached).

Consider a spec amendment first: `advanceFanOutBranches` / `awaitFanOutPeerRow` / `advanceFanOutPendingPeersAtStage` add ~140 lines of coordination subspec 01 never specifies, and three places can now dispatch a peer branch.

Then **subspec 01's two mutation pins**, which are inert today: the task arrays are built eagerly with `.map()`, so serializing the awaits changes nothing and the suite stays at 73 pass / 0 fail. Making them real needs lazy thunks so the concurrency lives in the awaiting line. Do that *after* `awaitFanOutPeerRow` — with the spin still in place the serialized form hangs instead of failing, which is what made the first attempt look like a fixture problem. The `## Blocker` on the branch still carries that superseded reading; the corrected one is above.

Then **`ready-intents/pipeline-stage-dispatch-claim`** — its Prerequisites name the concurrent-dispatch and branch-scoped `stageArtifacts` interfaces, so it stays blocked until #2577 lands. Needs `jarvis run workflow plan` first.

| Slice | Shipped |
| --- | --- |
| 1 — shell layout | #2453, #2456 |
| 2 — pipeline tree | #2462, #2463, #2466, #2471, #2473, #2479, #2481, #2485 |
| 3 — elapsed columns | #2490, #2492 |
| 4 — detail pane | #2511, #2519, #2521 |
| 5 — command dock | #2529, #2530, #2531, #2533, #2545 (editor), #2554 (dispatch), #2575 (status row) — **complete** |
| 6 — steering + log | not seeded |

## The fan-out rescope

The original spec (`fan-out-stage-dispatch-preserves-workflow-ownership`) was retired by #2562 after adversarial review disproved its premise: destination worktrees were **already** distinct from the predecessor on `main`, so its ownership guard enforced nothing and its headline change was inert. Three implement attempts went into it — two blocked on hollow mutation checkpoints, the third produced a red gate and dead code. PR #2555 was closed unmerged; its branch `fan-out-destination-ownership` is retained, since the concurrent-dispatch `Promise.all` work and the `stageArtifacts` branch-keying defect are both referenced by the two remaining intents.

The rescoped seed (#2562) split into three intents (#2563). The first, stage linkage, shipped in #2566 in a single pass with every guard proven reachable.

**Non-problems — do not re-derive these.** The seed carrying them was consumed by its intent split, so they are recorded here instead. Destination worktrees were already distinct from the predecessor: reverting `resolvePlanStage` to baseline semantics leaves both ownership regressions green, because plan destinations are `plan/${ready.name}`, derived per downstream ready-intent, on `main` too. `destinationDistinctFromPredecessor` asserts an invariant that already held and has no production call site; `selectChainedStageCwd` and `PriorArtifactContext.cwd` became dead code. Adding `chainedInputRoot` to plan resolution changed the ready-intent **read path**, not ownership — keep that part, drop the ownership framing. Full evidence: #2562's seed diff and #2555's body.

## Open seeds, newest first

| Seed | Why |
| --- | --- |
| `seeds/implement-rerun-completes-over-a-stale-dirty-worktree` | An implement re-run executed in a worktree three commits behind its `--base` with four modified tracked paths, read the previous run's ticks as truth, and settled `completed` having committed nothing. Its successor step then ran 75 min on the debris with a stranded `@mutate` on disk. Root cause unproven — first AC is a reproduction. |
| `seeds/entry-run-settlement-terminalizes-live-rows` | #2566 guarded the writers but not `applyEntryRunSettlement`, which still writes `failed` + `endedAt` with no liveness re-check. `waitForWorkflowEntryRun` does not await anything for a run with no registered promise, so `wait` can resolve non-`completed` over a live run. Remaining path to `startedAt == endedAt`. Also records one inert guard from #2566. |
| `seeds/plan-review-must-falsify-guard-premises` | A criterion of the form "rules out X" is only legitimate if X is reachable on `main`, and nothing checks it. Cost three implement runs and two spec amendments on the retired fan-out spec. Puts the check in plan **review**, before implementation. |
| `seeds/plan-output-fails-lint-md-and-repair-edits-unrelated-source` | Recurred twice in one session: plan drafts finalize without linting their own Markdown, the gate goes red on `lint:md`, and repair answers by rewriting unrelated production files and committing nothing. |
| `seeds/pipeline-implement-stage-breaks-when-its-plan-pr-merges` | The implement stage bases its PR on the plan stage's branch, so merging the pipeline's own green plan PR kills it with `Base ref must be a branch`. Also downgrades the diagnostic to `harness_failure`/`stop` over a run that is `resumable`. |
| `seeds/unparseable-mutation-directives-pass-the-gate` | An unresolvable `@mutate` directive is stderr-only and does not fail the gate. **Hit four times in one session (2026-08-03)**, including one that let a 40% cost over-bill tick green. Highest-value open seed. |
| `seeds/mutation-verification-outlives-its-run` | An `iteration_timeout` stranded three applied `@mutate` directives in production source. **Recurred 2026-08-03** — a settled run's worktree still held `if (false)` in `wrapMonitorRows`, and it was copied forward into a hand salvage before being caught by diffing. |
| `seeds/gate-autofix-can-turn-a-green-tree-red` | `bun run fix` rewrites `findIndex` → `indexOf` on a possibly-`undefined` needle. Cannot self-repair, since every repair entry re-runs autofix. |
| `seeds/mutation-selector-fires-on-prose-mentions-of-the-marker` | Selects on a bare `@mutate` substring, so a spec discussing the marker in prose fails its own gate. |
| `seeds/tui-waitstate-is-polled-but-no-longer-rendered` | Slice 4 left `waitState` with no reader while the `wait` RPC still fires per selection change. Fold into slice 6 planning. |
| `seeds/intent-landing-contract-rejects-wrapped-bullets` | Still open. Blocked two intent runs on 2026-08-01. |

## Defer unless you hit them in session

| Seed / intent | Status | Notes |
| --- | --- | --- |
| `seeds/iteration-timeout-discards-completed-subspecs` | Open; bit twice on 2026-08-03 and again on 2026-08-04 | Cost two salvages. Workaround: split large subspecs at plan time. |
| `seeds/out-of-scope-gate-classification-strands-caused-failures` | Open | Run-caused test failures classified out of scope (#2313). |
| `ready-intents/emit-completion-commit-errors-from-execution-loops` | Ready | Second link of the completion-commit chain; #2549 shipped the first. Copy the returned `completionCommitError` onto every terminal `loop_finished` event. |
| `ready-intents/project-completion-commit-errors-on-run-results` | Ready | Third link — project the durable message onto `list` / `wait` as `error.completionCommitError`. Needs `emit` first. |
| `ready-intents/render-completion-commit-errors-in-run-cli` | Ready | Fourth link — surface it in `run wait` JSON and a `run list` column. Needs `project` first. |
| `ready-intents/split-v2-review-prompt-ids-from-v1.md` | Ready | Three of four v2 review prompts tell reviewers the payload is "not a unified diff" while sending one. |
| `ready-intents/pipeline-terminal-state-waits-for-stage-settlement.md` | Ready | A failed branch makes the pipeline read terminal while a sibling is still running. Observed live. |

## Rule

The TUI brief and pipeline trustworthiness are the two active threads. Nothing else is open.

## Configured pipeline

Dogfooded 2026-08-03 on a real seed and it produced #2546/#2547/#2549 — but the run surfaced three defects and did not reach its terminal action. Until `seeds/pipeline-implement-stage-breaks-when-its-plan-pr-merges` ships, **do not merge a pipeline's intermediate PRs while it is still running** — the implement stage bases its PR on the plan branch, and merging that branch deletes the base ref. Fan-out gates still need approving one at a time, and `pipeline wait` returns instantly on un-approved sibling gates, so it cannot track the branch you approved; poll `pipeline list` instead.

Use pipelines for **seeds** (they start at the intent stage, which is what a seed needs) and standalone workflows for artifacts already past that point — feeding a ready-intent to `pipeline start` re-splits work that is already split.

## Carried operator notes

- **Verify by exit code, never by output text.** Two wrong "green" calls came from reading `tail -1` of `bun run check` and from summing reported pass/fail lines — a test file that hangs and never reports contributes nothing to the count, so `test:v2` exited 1 while the tally read "2611 pass / 0 fail".
- **After any mutate/restore cycle, diff the tree before committing.** A verification cycle left mutated text in place on #2561 and it got committed; the real fix was never on the PR until review caught it.
- **A run that dies before finalization has verified nothing.** Four runs in one session ticked every criterion — including criteria naming `bun run check` — while their gate was red or never ran. Every salvage needs the full gate re-run by hand.
- **Review every implement diff with a subagent before merging.** Every review across the last four sessions found something real, including `DO NOT MERGE` verdicts on work the operator had already called green.
- **A second hollow mutation checkpoint on a different guard is a premise smell, not a proof-form problem.** Amending the criterion is the wrong repair. Revert the change's core semantics and re-run its regressions — if they still pass, the change is inert.
- **CI does not run `lint:md` on every workflow.** Run it locally before merging any markdown-touching PR, and note that a line beginning `#1234` parses as a heading.
- `bun test` **does not typecheck.** Hand-finishing: `bun run check` and `bun run typecheck`.
- **A settled run row can have a live successor step.** `eabc39a7` read `completed` while review step `639c40a6`, dispatched the same millisecond, ran 75 more minutes on a debris worktree. `run list` gives no hint. Check for live rows on the branch, not just the ID you launched.
- **Backing a file up to `.git/` inside a worktree silently fails** — `.git` there is a *file*, so `cp x .git/backup` errors `Not a directory`. It cost two stranded `@mutate` applications during a hand verification. Back up outside the repo, or just `git checkout --` the file.
- **One green run of a concurrency test proves nothing.** #2577's `pipeline-end-to-end` file hangs 1 in 3; the hand-gate passed, CI killed it. Run the affected file 5+ times before calling a concurrency change green.
- **Do not admin-merge over a red check.** It reddened `main` once (#2417).
