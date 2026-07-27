# Admit a ticked spec whose lineage failed mutation verification

`validateSpecTreeCompletion` (`v2/src/execution/implement-workflow-steps.ts:264`) refuses any
all-ticked spec with `implement.already_complete`, derived from the spec tree alone. When the
implement run ticked every criterion and then settled `surviving_mutation_failed`, the branch is
complete by the spec but under-covered, and the only recovery today is unticking criteria or
hand-running `jarvis run resume <runId>` against a run ID the operator has to find.

`resolveReviewMutationResumeContext` / `resumeReviewMutationFinalization`
(`v2/src/execution/workflow-runner.ts:2625`, `:2862`) already own that recovery tail
(re-verify/gate/publish, agent-free) for a durable review row once its `runId` is known. This
subspec makes `jarvis run workflow implement` find that row itself instead of requiring the
operator to supply a run ID, and widens what it can recover from.

## Decisions

- **Admission set matches the resolver's own resumable set exactly**: `surviving_mutation_failed`,
  `ready_gate_failed`, `completion_commit_failed` (`REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS`,
  `workflow-runner.ts:2594`) — not a narrower subset. Narrowing to `surviving_mutation_failed`
  alone would let the admitted tail itself settle `ready_gate_failed` on retry, and a second
  `jarvis run workflow implement` would refuse again with no recovery path; matching the resolver's
  full set means every outcome the tail can produce is also an outcome the tail can later be
  re-admitted from. Whether a fresh iteration of agent-bearing mutation repair (subspec 01) runs is
  decided separately, by the *current* re-verification result inside the tail, not by which outcome
  admitted the invocation.
- **Lineage resolution is a new state-store query, not invocation vocabulary.** The store has no
  concept of "workflow invocation" and no per-project+branch listing today — only
  `findRunByProjectBranch({project, branch, stepId})`. Add
  `findReviewMutationLineageRows({project, branch})` returning every row for that project+branch
  across all `stepId`s, most-recently-created first. Resolution walks that list, keeps only rows
  where `resolveReviewMutationRowHead` admits (durable, failed review/review-debate step with a
  resolvable write-step sibling), reconstructs each via `resolveReviewMutationResumeContext`, and
  keeps the first (most recent) whose `context.specPath` — resolved from the row's own durable
  write-step sibling, never the review row's own fields — equals the requested spec's resolved
  absolute path. This makes "current implement-run lineage" concrete: the most recent admissible
  row whose write step actually wrote the requested spec.
- **No separate "superseded invocation" refusal case.** Because resolution always takes the most
  recent matching row, an older invocation for the same spec is never independently reachable as a
  refusal shape — it is just not the one picked. The only refusal shapes are: (a) no admissible row
  for this project+branch at all, (b) admissible rows exist but none match this spec's resolved
  path, (c) the matching row's outcome kind is outside the admission set, and (d) the matching row's
  worktree/branch is not retained (below). (a)–(c) all surface as the existing
  `implement.already_complete`; (d) is a distinct refusal.
- **Branch resolution for admission reuses the CLI's own resolution, not a re-derivation.** The
  builder already resolves the target branch as `resolvedInput.branchName ?? basename(dirname(specPath))`
  (`implement-workflow-steps.ts:203`) before this check would run. The daemon dispatch (below)
  receives that already-resolved `branch` explicitly in its request payload, so a lineage created
  under an explicit `--branch` is found the same way a fresh `--branch` invocation would find its
  own prior row — no independent branch-basename guess inside the resolver.
- **"Retained worktree/branch" is an explicit, observable check**, run only after a lineage row is
  otherwise admitted: `existsSync(writeRun.worktreePath)` is true, and `git rev-parse --verify
  refs/heads/<branch>` succeeds against that worktree. Either failing means a prior stale-workspace
  reset or manual cleanup already retired the branch/worktree — recovery cannot continue there.
  This produces a refusal distinguishable from "genuinely complete": `implement.recovery_target_missing`,
  naming the missing worktree path or branch. `implement.already_complete` is reserved for "no
  admissible lineage row exists at all" or "the spec really has no unchecked criteria."
- **Concurrency**: a live/claimed run on the target worktree is refused the same way `resume`
  already refuses it — `checkWorktreeClaimed` (`daemon.ts`) runs before recovery claims the
  worktree. Recovery attempted while the branch's worktree is claimed by another run returns the
  existing `worktree_claimed` refusal and starts nothing; it is not queued or retried.
- **The admission check and the dispatch into recovery are one new daemon request**,
  `implement.recover`, issued from inside `runWorkflowCommand`'s existing `withConnectDispatch`
  block (`v2/src/commands/workflow.ts:308`) before `maybeResetStaleWorkspace`/`startWorkflowRun` run.
  Request payload: `{ project, branch, specPath }` (the CLI's already-resolved values — see branch
  resolution above; JSON-serializable, no functions, consistent with the existing workflow-step IPC
  contract). Response is one of:
  - `{ kind: "not_admitted" }` — the CLI falls through to today's `buildImplementWorkflowSteps`
    path unchanged, preserving the existing `already_complete` / `recovery_target_missing` /
    `worktree_claimed` refusal text and exit code.
  - `{ kind: "admitted", ok: true, prNumber?, prUrl? }` — recovery ran and published; command exits 0.
  - `{ kind: "admitted", ok: false, message }` — recovery ran and re-failed (still-surviving
    mutation, budget exhaustion, gate/commit failure); command exits non-zero with `message`.
  `--detach` (parsed today at `workflow.ts:296`) applies to `implement.recover` exactly as it
  applies to a fresh `start`: detached, the CLI returns immediately after the daemon accepts the
  request; attached, it blocks for the terminal response.
  The `already_complete` refusal itself is **deferred, not deleted**: `validateSpecTreeCompletion`
  keeps its current shape and keeps running for every invocation; `implement.recover` is a
  daemon-side pre-check that can short-circuit past it, never a replacement for it.
- **Admitted recovery skips `maybeResetStaleWorkspace` and `startWorkflowRun`/workflow `start`
  entirely** — it claims the *existing* worktree of the matched row and dispatches directly into
  the finalization tail; it never resets, re-clones, or replays the write step, and never unticks
  criteria.
- **The existing conditional at `implement-workflow-steps.ts:376`**
  (`deps.resolveActiveLinkedSubspec === undefined || deps.readSpecFile !== undefined`) is
  test-injection scaffolding for `validateSpecTreeCompletion`'s dependencies, not a production
  gate — real callers pass neither override, so validation always runs. `implement.recover` sits
  in front of that call inside connected dispatch and is unaffected by it; the conditional and its
  existing ordering guarantees are preserved unchanged by this subspec.

## Sequencing note

This subspec's re-verification-kills-the-mutation criterion below is reachable only by directly
editing the retained worktree's fixture content in the test (simulating an operator/prior-agent
fix) — subspec 01 is what lets a *live agent* close that gap, and does not exist yet when 00 lands.
`index.md` orders `00` before `01` for this reason: `00` proves the admission/dispatch/re-verify/
publish tail with a hand-fixed worktree; `01` adds the agent iteration that produces that fix
without operator intervention.

## Tasks

- Add `findReviewMutationLineageRows({project, branch})` to the state store.
- Add daemon-side lineage resolution: walk lineage rows, admit via `resolveReviewMutationRowHead` +
  `resolveReviewMutationResumeContext`, match `specPath`, check outcome-kind membership, check
  worktree/branch retention.
- Add the `implement.recover` daemon request and wire it into `runWorkflowCommand` ahead of
  `maybeResetStaleWorkspace`/`startWorkflowRun`, gated by the existing `checkWorktreeClaimed`.
- Add the `implement.recovery_target_missing` refusal, distinguishable from `already_complete`.
- Cover admitted (each of the three outcome kinds), not-admitted (no lineage, spec mismatch,
  outside admission set), retention-failed, and worktree-claimed shapes, including absence of side
  effects on refusal.
- Align workflow-runner, operator, and v1-behavior docs.

## Acceptance criteria

- [ ] `v2/src/commands/workflow.test.ts` drives an all-ticked spec whose latest lineage row settled
      `surviving_mutation_failed` on a retained worktree/branch and proves `jarvis run workflow
      implement` advances it into the mutation-finalization tail instead of returning
      `implement.already_complete`; the test fails against the baseline.
- [ ] The same test file proves a lineage row settled `ready_gate_failed` or `completion_commit_failed`
      is independently admitted the same way (one case per outcome kind).
- [ ] A failed row from a different spec does not admit recovery: the command returns
      `implement.already_complete` and exits non-zero, with no worktree claim and no daemon-side
      finalization dispatch.
- [ ] A failed row with an outcome kind outside the admission set (e.g. `runtime_smoke_failed`) does
      not admit recovery: same refusal, same absence of side effects.
- [ ] A matching row whose worktree no longer exists on disk, or whose branch no longer resolves in
      git, returns `implement.recovery_target_missing` (distinct from `implement.already_complete`)
      and performs no worktree claim, no finalization dispatch, no agent invocation.
- [ ] A genuinely complete spec with no lineage row at all returns `implement.already_complete`
      before any worktree or agent side effect: no `implement.recover` admission, no stale-workspace
      reset, no workflow `start`, no agent invocation.
- [ ] Recovery attempted against a branch whose worktree is claimed by another live run returns the
      existing `worktree_claimed` refusal and performs no finalization dispatch.
- [ ] Admitted recovery leaves every acceptance criterion ticked and records zero additional
      `patch.prompt.body` write-step invocations.
- [ ] When re-verification (against a worktree where the surviving mutation has already been fixed
      directly in the test fixture) finds no surviving mutation, recovery runs the ready gate and
      publication and settles the workflow `completed`, and the command exits 0.
- [ ] When re-verification still finds a surviving mutation, the owning row stays failed and
      retryable and no criterion is unticked (subspec 01 adds the agent-bearing repair step in
      front of this outcome).
- [ ] Existing `implement.already_complete` and preflight coverage in
      `v2/src/execution/implement-workflow-steps.test.ts` stays green.
- [ ] Inverting the outcome-kind admission guard, the spec-match guard, and the worktree/branch
      retention guard each independently turns the corresponding negative case above RED, proving
      in each case that no finalizer, publisher, committer, or agent ran.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § Building `implement` workflow steps from cwd + run args — document
  the `already_complete` exception, the `implement.recover` dispatch, and admission conditions
  (widened outcome set, lineage resolution, retention check, concurrency refusal).
- `v2/docs/operator-runbook.md` § Gate trust and § Publication / completion failures — document
  one-command recovery over ticked criteria, and the `recovery_target_missing` / `worktree_claimed`
  refusal cases.
- `v2/docs/v1-behaviors.md` — record the changed v2 implement preflight and recovery contract.
