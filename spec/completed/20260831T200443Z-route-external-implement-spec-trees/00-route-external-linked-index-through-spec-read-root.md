# Route external linked index through specReadRoot

`runLinkedImplementStep` resolves the admitted external `index.md` and every linked subspec through `resolveInWorktree(worktreePath, …)` and passes the code worktree as `projectRoot` to `resolveActiveLinkedSubspec`, so external links classify as `link_out_of_tree` and the active subspec never reaches the implement prompt.

## Decisions

- Stamp `specReadRoot` on the implement write step when `externalPlanSpec: true`; rules out re-deriving the external tree from absolute `specPath` on every routing hop.
- For admitted external runs, index reads use `step.specPath` (absolute external `index.md`); linked routing uses `specReadRoot` (`plans/<name>/`); both derive from the same admission identity and must not diverge for admitted plans.
- Serialized `specReadRoot` on `WriteWorkflowStep` is authoritative on replay; `dirname(absolute specPath)` is fallback only when absent; rules out re-deriving the external root from `specPath` on resume.
- For `externalPlanSpec` linked runs, treat `specReadRoot` as the routing root for `resolveActiveLinkedSubspec` / `resolvePinnedLinkedSubspec`; rules out passing the materialized code worktree as `projectRoot` to linked routing.
- Keep agent `cwd`, code edits, worktree materialization, and completion publication on the ordinary `--base` worktree; rules out using the external plan directory as the implementation worktree.
- Set `expectedArtifactPath` to the active linked subspec's canonical absolute path for external runs; rules out `relative(worktreePath, externalPath)` artifact paths that escape or mislabel the completion target.
- Preserve in-repo linked routing by continuing to use the worktree (or project root before materialization) as the routing root when `externalPlanSpec` is absent; rules out an external-only fork of `runLinkedImplementStep`.

## Tasks

- Extend `WriteWorkflowStep` with optional `specReadRoot` and populate it from `buildImplementWorkflowSteps` for admitted external plan indexes.
- In `runLinkedImplementStep`, branch external linked runs: read the index from `step.specPath` (already absolute), route with `specReadRoot`, and pass the active subspec's absolute path as `expectedArtifactPath`.
- Add a `workflow-runner` regression that drives `executeWorkflow` with `externalPlanSpec: true`, an external multi-link fixture under `~/.jarvis/specs/`, and a fake binding; assert the write loop receives the first criteria-incomplete external subspec path and prompt body while `cwd` stays in the materialized worktree.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner.test.ts` regression drives `executeWorkflow` linked routing for an admitted external plan index, asserts the first criteria-incomplete linked subspec becomes `expectedArtifactPath` and appears in the implement prompt, and fails against the pre-fix worktree-relative `link_out_of_tree` routing path.
- [x] `v2/src/execution/workflow-runner-debate.test.ts` `executeWorkflow linked implement routing` stays green (in-repo linked routing unchanged).

## Documentation updates

- None in this subspec; `05` owns operator-facing docs.
