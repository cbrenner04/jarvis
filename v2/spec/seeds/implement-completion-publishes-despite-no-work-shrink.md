---
name: implement-completion-publishes-despite-no-work-shrink
---

# A completed implement whose shrink returns no_file_changes silently skips publication (no push, no draft PR)

## Problem

A standalone `jarvis run workflow implement` can complete a spec fully — every acceptance criterion ticked, index box ticked, real commits on the worktree branch — yet never push the branch or open a draft PR. The run reports `outcomeKind`/`runStatus: completed` and the operator sees no PR, no origin branch, and no third publication run row. The work is stranded and must be hand-published.

Observed 2026-08-23 implementing `20260823T000833Z-dismiss-run-durable-flag`: the entry implement run completed (`outcomeKind: done`), a shrink run then recorded `iteration_commit skipReason: "no_file_changes"` and a `no-work` boundary that self-completed the run, and publication never fired. Branch `git ls-remote`-absent from origin; operator pushed `HEAD:<branch>` and opened the PR by hand.

## Evidence (root cause)

Publication is the tail of `executeWorkflow` (`v2/src/execution/workflow-runner.ts:963-1184`), shared by standalone and pipeline stages (both via `handleWorkflowStart`). Individual steps never publish (`prepareWorkflowStep` hard-codes `publishCompletion: false`, `workflow-runner.ts:1576`); the `~shrink` step is the publishing boundary. The push + `gh pr create --draft` + ready-gate block is wrapped in `if (published.commitSha !== undefined)` (`workflow-runner.ts:1035`). When the post-implement shrink returns `no_file_changes`/`no-work`:

- the `no-work` boundary marks the shrink run `completed` on its own (`write-loop.ts:1711-1717`; `keepsCompletionInProgress` false because `publishCompletion===false`),
- `shrinkResult.kind === "complete"`, so the early return at `workflow-runner.ts:818` is not taken and control reaches the tail,
- the tail completion committer yields no `commitSha` for the clean post-shrink worktree, so the `:1035` block is skipped, the silent no-op branch at `:1003-1034` (empty `namedPaths` on a clean tree) does nothing, and control falls to the terminal `return { kind: "complete" }` at `workflow-runner.ts:1216` — run `completed`, spec ticked, branch unpushed, no PR.

The secondary skip gate is `publicationAgent !== undefined` at `workflow-runner.ts:963` (resolved from `completionAgent`, `:851-854`): if neither implement nor shrink attributed an agent, the whole tail is skipped the same way. The tail committer at `:993` runs with `forceDistinctCommit: true` (normally yields a `commitSha`), so the defect is that a no-work shrink leaves an empty completion snapshot that defeats that path.

Pipeline risk: `settlePipelineTerminalPublication` → `executeTerminalPublication` only ready-flips/merges an existing draft PR; it does not create one. So a pipeline implement stage whose shrink no-works would skip draft creation and then fail terminal publication with no draft to flip.

## Decisions

- When the implement workflow completes a spec (run settles `complete`) and the worktree branch has commits ahead of the resolved base that are not yet published, the completion tail must still push the branch and create the draft PR — a no-work shrink or an empty tail-completion snapshot must not silently skip publication. Rules out the current `commitSha !== undefined`-only gate swallowing publication on an otherwise-landable branch.
- The publish decision keys off "branch has unpublished completed work" (commits ahead of base with no open PR for the branch), not solely off a fresh tail commit produced this iteration. A no-work shrink that adds no new commit but sits atop real implement commits still publishes. Rules out equating "no new commit this boundary" with "nothing to publish."
- Preserve the genuine no-op case: a run that produced zero commits total against a clean worktree (nothing implemented) still does not publish. Rules out pushing an empty branch equal to base.
- The `publicationAgent === undefined` skip (`:963`) must not drop publication for a completed spec that has publishable commits — resolve the publishing identity from the run/step attribution that produced the commits, or fall back to a non-agent publish, rather than silently skipping. Rules out losing publication when the final boundary attributed no agent.
- Fix is in the shared `executeWorkflow` completion tail so standalone `run workflow implement` and pipeline implement stages both publish; a pipeline stage then still ready-flips via `executeTerminalPublication` as today. Rules out a pipeline-only or standalone-only patch.

## Acceptance criteria

- [ ] An implement workflow that reaches `complete` via a `no-work`/`no_file_changes` shrink, atop a worktree branch carrying real completed-spec commits ahead of base, pushes the branch and creates the draft PR — pinned by a `workflow-runner.test.ts` test that drives the shrink to `no_file_changes` and asserts the push + `gh pr create` seams are invoked (fails against the pre-fix `:1035`/`:1003-1034` fall-through).
- [ ] A run that produced no commits against a clean worktree still does not push or open a PR — pinned by a test (no empty-branch publication).
- [ ] A completed spec whose final boundary attributed no `completionAgent` but whose branch has publishable commits still publishes — pinned by a test over the `:963` gate, or the plan documents why that path cannot occur and removes the risk.
- [ ] The shared tail change publishes for both standalone `run workflow implement` and a pipeline implement stage (whose terminal publication then ready-flips the created draft) — pinned by an execution/pipeline test that a pipeline implement stage whose shrink no-works still yields a draft PR for terminal publication to flip.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — the completion publication contract: publication fires whenever the completed branch has unpublished commits ahead of base, not only when the final boundary produced a fresh commit; a no-work shrink over real implement commits still publishes.
- `v2/docs/operator-runbook.md` — remove or update any note implying a `completed` implement always yields a PR; cross-link this seed until it lands. Note the hand-publish fallback (`git push origin HEAD:<branch>` + `gh pr create`) for a stranded completed implement.
