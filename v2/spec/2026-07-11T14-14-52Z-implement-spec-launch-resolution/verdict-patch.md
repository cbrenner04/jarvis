## Verdict

**Required outcome: the CLI-resolved implement launch must preserve project identity (`projectName`) end-to-end, not silently discard it.**

- `resolveImplementWorkflowInput` (v2/src/cli.ts:675-713) resolves the project via `findProjectMatch`, which returns both `key` and `root`, but only forwards `match.root` into `ResolvedImplementWorkflowInput` — `match.key` is dropped.
- `buildImplementWorkflowSteps` (v2/src/execution/implement-workflow-steps.ts:32-50) then hardcodes `match = { key: "", root: input.projectRoot }` whenever `projectRoot` is supplied — which is exactly the new CLI-resolved path this spec adds (cli.ts always passes `resolved.projectRoot`).
- This `key` becomes `worktree.projectName` (implement-workflow-steps.ts:86), which composes the daemon's `OwnershipKey` for run mutual-exclusion. An empty `projectName` degrades the ownership key to just `:<branch>`, creating a real collision risk between two different registered projects using the same branch name for an implement run.
- The spec's own decision — "resolve the registered project from `--spec`" — implies project identity is preserved through the resolved path, not just its filesystem root. Losing `projectName` contradicts that guarantee and is a functional regression, not a style nit.

**Fix:** thread `match.key` from `resolveImplementWorkflowInput` through `ResolvedImplementWorkflowInput` and into `BuildImplementWorkflowStepsInput`/`buildImplementWorkflowSteps`, so `projectName` reflects the real registry key for CLI-resolved launches instead of `""`.

**Required test coverage:** add a test exercising the CLI-resolved (`projectRoot`-supplied) path in `implement-workflow-steps.test.ts` (or an equivalent CLI-level test) asserting the built step's `worktree.projectName` equals the actual registry key, not the empty-string fallback. Today only the cwd-based `resolveProjectMatch` fallback path is covered, so this regression has no test that would catch it.

The duplicated `isIndexSpec` derivation between `cli.ts` and `implement-workflow-steps.ts` is a minor cleanup opportunity, not spec-mandated scope — optional, not required for this verdict.