---
name: implement-publication-tail
---

# The implement publication tail either publishes or fails loudly — never silently strands

Merges the former `implement-completes-without-publishing` and `implement-publication-reuses-closed-same-branch-pr` seeds (2026-09-05 compaction) — the never-dispatches and mis-resolves halves of one broken tail. The 2026-09-03 close status called the publication tail "where work is lost, not the authoring": every strand class here follows complete, gate-green work.

## Half 1 — completion without publication (verify-or-reap)

`run workflow implement` settles `completed` with the branch committed but never pushed and no PR — no error, no failed row. Evidence: 2026-08-29, three standalone implements all local-only, hand-published (#3086, #3087). **Counter-evidence 2026-08-30: all four standalone implements that session auto-published** — root-cause whether the successor-dispatch gap is real or was environmental before building. Decisions: a `completed` implement with committed, unpushed work either publishes (push + draft PR) or settles a named, operator-visible failure; if publication is genuinely a separate operator step somewhere, the docs and `run list` say so.

## Half 2 — ready-flip resolves a closed same-branch PR

Multi-subspec specs route every subspec through one branch, so subspec N's publication resolves subspec N-1's merged same-branch PR and fails `ready_flip_failed` ("Only draft pull requests can be marked ready") instead of opening a fresh draft. Evidence: 2026-08-29 run `949a26cb` (hand-published as #3069); **live again 2026-09-03**: a lane ready-flipped #3396 (a prior subspec's merged PR) and settled `ready_flip_failed` with its completed 5/5 work holding no PR. Related: `defaultGhReadyFlip` still resolves by branch with no state filter (#3449 fixed a different call site — 2026-09-05 audit).

Decisions: publication resolves the PR to flip by open/draft state, never most-recent match — a branch whose only matching PR is merged/closed opens a fresh draft; an unexpected open non-draft fails with a named actionable error, never the raw GitHub string; scope to the publication PR-resolution seam, no change to branch reuse.

### Half 1 verified, not reaped (2026-09-11)

The counter-evidence is resolved against Half 1, not for it. Two standalone implement lanes settled `completed` / `not-live` with **no `prNumber` and no `prUrl` on the durable row**, real commits on the branch, and nothing pushed:

| Branch | Commits ahead of `origin/main` | On origin | PR |
| --- | --- | --- | --- |
| `20260911T142243Z-pipeline-list-rpc-terminal-retention` | 1 | no | none |
| `20260910T231922Z-provisional-skip-provenance-in-state-store` | 4 | no | none |

Both were acceptance-complete at settlement (8/8 and 10/10 + 9/9; the only unticked boxes were in the informational `## Task checklist`). This follows four for four on 2026-09-10, so the mode is reproducible across sessions, models and specs — it is not environmental.

**The narrowing that matters: it is specific to the implement stage.** In the same session, on the same daemon, `intent` and `plan` stages published normally and ready-flipped — [#3778](https://github.com/cbrenner04/jarvis/pull/3778), [#3780](https://github.com/cbrenner04/jarvis/pull/3780), [#3781](https://github.com/cbrenner04/jarvis/pull/3781), [#3782](https://github.com/cbrenner04/jarvis/pull/3782) (intent) and [#3783](https://github.com/cbrenner04/jarvis/pull/3783) (plan). So `git`, `gh`, `origin`, auth and the publication primitives are all working; only the implement completion tail fails to reach them. Combined with 2026-09-10's finding that every durable row on such a branch is an `implement~link-N` whose log ends at `loop_finished` with no publication trace, the successor-dispatch gap named in this half's first acceptance criterion is the live hypothesis.

**Counter-example in the same session, and it narrows the hypothesis sharply.** A fourth lane, `20260910T230153Z-surviving-mutation-settlement-records-killing-set`, published correctly and unaided: pushed, [#3787](https://github.com/cbrenner04/jarvis/pull/3787) opened, ready-flipped, and `prUrl` recorded on the durable row. So the tail is not uniformly broken. The distinguishing property is how the lane was dispatched:

| Lane | Dispatch | Published |
| --- | --- | --- |
| `surviving-mutation-settlement-records-killing-set` | fresh, after `cleanup --abandon` retired the old workspace | **yes** |
| `provisional-skip-provenance-in-state-store` | re-dispatch onto an existing branch carrying prior commits | no |
| `pipeline-list-rpc-terminal-retention` | chained pipeline implement stage | no |
| `bulk-terminal-run-dismissal-store` | chained pipeline implement stage | no |

That is the shape to test first: a lane whose workspace and branch are materialized fresh from base publishes, while a re-dispatch over an existing branch and a chained pipeline implement stage do not. It is consistent with 2026-09-10's observation that every durable row on a failing branch is an `implement~link-N` whose log ends at `loop_finished` with no publication trace — the successor that publishes is not dispatched when the run re-enters an existing lane. Confirm the correlation against more lanes before building on it; four lanes is suggestive, not conclusive.

This also silently violates the completion-honesty contract, under which a `completed` implement implies confirmed PR evidence — so the row is not merely unhelpful, it is untrue.

### Half 1 root cause (2026-09-11) — there is no throw, and the row is settled before publication

The first acceptance criterion asks for the root cause before the fix. It is not a successor-dispatch race and not environmental. Three independent mechanisms compose:

**1. A workflow write step's durable row is settled `completed` before any verification runs.** `prepareWorkflowStep` hard-sets `publishCompletion: false` (`v2/src/execution/workflow-runner.ts:1865`), and `keepsCompletionInProgress` in the write loop requires `args.publishCompletion !== false` (`v2/src/execution/write-loop.ts:1876-1879`). So `boundaryRunStatus` takes `terminal.runStatus` (`"completed"`) instead of `"in-progress"`. At the moment `boundary_committed` is written the row is terminal, PR-less, and carries no `terminalCause`. Everything after that point is best-effort, which is precisely what the completion-honesty contract forbids.

**2. `executeWorkflow` bails on a non-`complete` step result with no log and no settlement.** `workflow-runner.ts:905-918` returns the step result verbatim when `stepResult.kind !== "complete"` — no log append, no store write. The producers that can return non-`complete` *after* the write loop has already logged `loop_finished: complete`, instantaneously and silently, are the linked-implement finalizers: `finalizeLinkedImplementPass` (`:717-742`, `link_incomplete` → `contract_miss`, `index_routing_mutated` → `blocked`, which also reverts the index tick it just wrote) and `linkedImplementRoutingFailureOutcome` (`:645-666`, routing failures → `blocked` on a phantom `crypto.randomUUID()` run id; `empty_index`/`already_complete` → `complete` with `implementReviewEligible: false`, which skips shrink *and* review).

**3. The daemon discards the result.** The admission handler's `execute().catch(...).finally(...)` (`v2/src/daemon/daemon-workflow-admission-handlers.ts:218-241`) has no `.then`, so the returned `WorkflowResult` is dropped. A non-`complete` workflow outcome on a run that already exists is recorded nowhere.

**`harness_failure` on the stage is not an exception.** It is the fallthrough in `pipeline-stage-settlement.ts:144` for a terminal entry run with no `terminalCause` and an unmapped last-attempt `outcomeKind: "done"` — exactly the row shape mechanism 1 produces.

**Proof there was no throw.** The daemon spawns with `stdio: [ignore, logFd, logFd]` (`daemon-lifecycle.ts:159-161`), and the admission catch both `console.error`s and appends `run_execution_failed`. The current daemon's log holds only its startup line and no run carries that record, while a *different* daemon generation's log does contain a caught error — so the path works and simply was not taken. Timing corroborates it: the stage's `ended_at` equals the `loop_finished` second, so the tail (gate, completion commit, publication — minutes of work) never started.

**Correction to the dispatch-shape table above.** The correlation is real but the causal axis is *who publishes*, not fresh-vs-re-entry. Lanes that publish do so **inside the write loop** (or from the review step), which is reached when `publishCompletion !== false` — the resumed lane `854d55f2` logged `runStatus: "in-progress"` and then `loop_finished … prNumber: 3787`. Lanes that defer publication to `executeWorkflow`'s tail are the ones gated behind mechanisms 2 and 3. Every implement publication observed this session came from the write loop or the review step; none came from the tail.

**Cheapest next step**, and it is diagnostic rather than structural: append a log event at each of the four silent return sites, so the next occurrence names which producer fired. Two candidates could not be separated from the surviving evidence — `index_routing_mutated` (`shared/linked-subspec-routing.ts:200-208`, plausible when a prior link's index tick was written to the worktree but never committed, so it reads as mutated on the next dispatch) and the `already_complete` re-scan. Independently of which one it is, mechanism 1 is a defect on its own: a `completed` implement row must not be written before publication evidence exists.

### Half 2 reproduced live (2026-09-12)

Half 1 shipped as [#3794](https://github.com/cbrenner04/jarvis/pull/3794). Half 2 is unchanged and reproduced cleanly on a multi-subspec spec whose subspecs land as separate PRs off one branch.

Spec `20260912T152453Z-classify-and-checkpoint-gate-refusals`, branch of the same name:

1. Subspec 00 landed as [#3804](https://github.com/cbrenner04/jarvis/pull/3804), squash-merged; GitHub closed the PR and retired the branch.
2. The spec was re-dispatched for subspec 01. The lane completed it: three commits including a `review-debate(1)` pass, 7/7 acceptance criteria ticked, and the index checkbox advanced — so routing was healthy.
3. Publication then resolved the **merged** #3804 as the branch's PR and called `gh pr ready` on it, settling `ready_flip_failed` / `resumable: false` / `nextAction: "stop"`.

`gh pr list --head <branch> --state all` returns exactly one row: `3804 MERGED draft=false`. There is no open PR to flip, and the lane's finished work has no PR of its own.

Note the title says *closed* same-branch PR; this instance is a **merged** one, which is the more common shape once land-a-slice is in use. Landing each subspec as its own PR is the documented way to converge a multi-subspec spec, and it is exactly what makes this fire — so the cost scales with subspec count and always lands on work that is otherwise complete and green. Publication must resolve an **open draft** PR for the branch, or open one, rather than accepting any same-branch PR regardless of state.

## Acceptance criteria

- [x] Half 1 root cause recorded (2026-09-11, above): workflow write steps settle `completed` before verification because `prepareWorkflowStep` forces `publishCompletion: false`; `executeWorkflow` returns a non-`complete` step result with no log and no settlement; the daemon discards that result.
- [ ] A workflow write step no longer settles its durable row `completed` before publication evidence exists — the honesty contract holds for workflow-dispatched implements as it does for the write-loop path, pinned by a test failing against the current `publishCompletion: false` settlement.
- [ ] Each silent non-`complete` return in `executeWorkflow`'s linked-implement finalization appends a durable log event naming the producer and reason, pinned by a test failing against the current no-log early return.
- [ ] A non-`complete` `WorkflowResult` returned to the daemon settles the owning run and stage with a named operator-visible failure rather than being discarded, pinned by a test failing against the current `.catch().finally()` with no `.then`.
- [ ] A publication whose branch has only a merged/closed matching PR opens and readies a fresh draft, pinned by a test failing against resolve-most-recent (covers every `defaultGhReadyFlip`-family call site).
- [ ] An open draft on the branch is still reused; the raw `ready_flip_failed` GitHub-string terminal is unreachable for closed-PR shapes.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — standalone publication contract; PR resolution keys off open/draft state.
- `v2/docs/operator-runbook.md` — retire the hand-publish stopgap bullets when shipped.
