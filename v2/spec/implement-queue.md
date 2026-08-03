# v2 implement queue

Authority: operator priorities. Updated 2026-08-03.

## Goal

Two threads are live. **TUI slice 5** is nearly done: the dock now edits (#2545) and dispatches (#2554); what remains is subspecs 02-04 of an already-planned spec. **Pipelines** are being made trustworthy: stage linkage landed (#2566), two seams remain. Slice 6 (steering + log) from [tui-overhaul-brief.md](tui-overhaul-brief.md) is still unseeded.

## Start here next

**`20260803T013930Z-tui-command-dispatch/` subspecs 02-04** — spec is on `main`, 00 and 01 shipped in #2554. Remaining: status-row projection, operator runbook, parity catalog. 03 and 04 are documentation-only subspecs, which is over-split; consider folding them into 02's Documentation updates rather than spending two implement runs on markdown. That finishes slice 5.

Then **`ready-intents/fan-out-concurrent-sibling-dispatch`** and **`ready-intents/pipeline-stage-dispatch-claim`**, in that order — the remaining two seams from the fan-out rescope. Both are ready-intents; each needs `jarvis run workflow plan` before an implement run.

| Slice | Shipped |
| --- | --- |
| 1 — shell layout | #2453, #2456 |
| 2 — pipeline tree | #2462, #2463, #2466, #2471, #2473, #2479, #2481, #2485 |
| 3 — elapsed columns | #2490, #2492 |
| 4 — detail pane | #2511, #2519, #2521 |
| 5 — command dock | #2529, #2530, #2531, #2533, #2545 (editor), #2554 (dispatch); subspecs 02-04 open |
| 6 — steering + log | not seeded |

## The fan-out rescope

The original spec (`fan-out-stage-dispatch-preserves-workflow-ownership`) was retired by #2562 after adversarial review disproved its premise: destination worktrees were **already** distinct from the predecessor on `main`, so its ownership guard enforced nothing and its headline change was inert. Three implement attempts went into it — two blocked on hollow mutation checkpoints, the third produced a red gate and dead code. PR #2555 remains open as a DO-NOT-MERGE record.

The rescoped seed (#2562) split into three intents (#2563). The first, stage linkage, shipped in #2566 in a single pass with every guard proven reachable.

**Non-problems — do not re-derive these.** The seed carrying them was consumed by its intent split, so they are recorded here instead. Destination worktrees were already distinct from the predecessor: reverting `resolvePlanStage` to baseline semantics leaves both ownership regressions green, because plan destinations are `plan/${ready.name}`, derived per downstream ready-intent, on `main` too. `destinationDistinctFromPredecessor` asserts an invariant that already held and has no production call site; `selectChainedStageCwd` and `PriorArtifactContext.cwd` became dead code. Adding `chainedInputRoot` to plan resolution changed the ready-intent **read path**, not ownership — keep that part, drop the ownership framing. Full evidence: #2562's seed diff and #2555's body.

## Open seeds, newest first

| Seed | Why |
| --- | --- |
| `seeds/entry-run-settlement-terminalizes-live-rows` | #2566 guarded the writers but not `applyEntryRunSettlement`, which still writes `failed` + `endedAt` with no liveness re-check. `waitForWorkflowEntryRun` does not await anything for a run with no registered promise, so `wait` can resolve non-`completed` over a live run. Remaining path to `startedAt == endedAt`. Also records one inert guard from #2566. |
| `seeds/plan-review-must-falsify-guard-premises` | A criterion of the form "rules out X" is only legitimate if X is reachable on `main`, and nothing checks it. Cost three implement runs and two spec amendments on the retired fan-out spec. Puts the check in plan **review**, before implementation. |
| `seeds/plan-output-fails-lint-md-and-repair-edits-unrelated-source` | Recurred twice in one session: plan drafts finalize without linting their own Markdown, the gate goes red on `lint:md`, and repair answers by rewriting unrelated production files and committing nothing. |
| `seeds/pipeline-implement-stage-breaks-when-its-plan-pr-merges` | The implement stage bases its PR on the plan stage's branch, so merging the pipeline's own green plan PR kills it with `Base ref must be a branch`. Also downgrades the diagnostic to `harness_failure`/`stop` over a run that is `resumable`. |
| `seeds/unparseable-mutation-directives-pass-the-gate` | An unresolvable `@mutate` directive is stderr-only and does not fail the gate. **Hit four times this session**, including one that let a 40% cost over-bill tick green. Highest-value open seed. |
| `seeds/mutation-verification-outlives-its-run` | An `iteration_timeout` stranded three applied `@mutate` directives in production source. |
| `seeds/gate-autofix-can-turn-a-green-tree-red` | `bun run fix` rewrites `findIndex` → `indexOf` on a possibly-`undefined` needle. Cannot self-repair, since every repair entry re-runs autofix. |
| `seeds/mutation-selector-fires-on-prose-mentions-of-the-marker` | Selects on a bare `@mutate` substring, so a spec discussing the marker in prose fails its own gate. |
| `seeds/tui-waitstate-is-polled-but-no-longer-rendered` | Slice 4 left `waitState` with no reader while the `wait` RPC still fires per selection change. Fold into slice 6 planning. |
| `seeds/intent-landing-contract-rejects-wrapped-bullets` | Still open. Blocked two intent runs on 2026-08-01. |

## Defer unless you hit them in session

| Seed / intent | Status | Notes |
| --- | --- | --- |
| `seeds/iteration-timeout-discards-completed-subspecs` | Open, and it bit twice this session | Cost two salvages. Workaround: split large subspecs at plan time. |
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

- **Verify by exit code, never by output text.** Two wrong "green" calls this session came from reading `tail -1` of `bun run check` and from summing reported pass/fail lines — a test file that hangs and never reports contributes nothing to the count, so `test:v2` exited 1 while the tally read "2611 pass / 0 fail".
- **After any mutate/restore cycle, diff the tree before committing.** A verification cycle left mutated text in place on #2561 and it got committed; the real fix was never on the PR until review caught it.
- **A run that dies before finalization has verified nothing.** Four runs this session ticked every criterion — including criteria naming `bun run check` — while their gate was red or never ran. Every salvage needs the full gate re-run by hand.
- **Review every implement diff with a subagent before merging.** Six reviewed this session; every one found something real, including two `DO NOT MERGE` verdicts on work I had called green.
- **A second hollow mutation checkpoint on a different guard is a premise smell, not a proof-form problem.** Amending the criterion is the wrong repair. Revert the change's core semantics and re-run its regressions — if they still pass, the change is inert.
- **CI does not run `lint:md` on every workflow.** Run it locally before merging any markdown-touching PR, and note that a line beginning `#1234` parses as a heading.
- `bun test` **does not typecheck.** Hand-finishing: `bun run check` and `bun run typecheck`.
- **Do not admin-merge over a red check.** It reddened `main` once (#2417).
