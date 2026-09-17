# 02 — workflow-runner-intent fixture + timings doc

`workflow-runner-intent.test.ts` builds git workspaces through `createIntentWorktreeHarness` in `workflow-runner.test-support.ts`, shared with other `workflow-runner-*` test files.

## Decisions

- Convert repo creation inside `createIntentWorktreeHarness` (not a file-local copy) so every sharing file benefits; initial commit content stays identical. `createIntentWorktreeHarness` stops calling `initGitWorkspace` and builds its workspace from the template helper directly.
- `initGitWorkspace` stays unconverted — it's called directly, with per-scenario prefixes, by many fixtures in `workflow-runner-publication.test.ts` and `workflow-runner-resume.test.ts` that are out of this intent's scope.
- `createLazyIntentWorktreeHarness` stays unconverted — it defers git init until first use, a lifecycle the template-copy pattern doesn't fit.
- The per-branch `mkdtemp` path prefix (e.g. `intent-workflow-${branchName}-`) is kept for the destination directory of each per-test copy.
- Measure before/after per-file wall times with `bun run test:cost` (`scripts/measure-test-cost.ts`), not ad-hoc timers. "Before" times for all three converted files (`intent-output`, `write-loop-intent-landing`, `workflow-runner-intent`) are measured at the merge base, since [00](00-template-helper-intent-output.md) and [01](01-write-loop-intent-landing.md) will already have landed by the time this subspec runs.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test-support.ts` `createIntentWorktreeHarness` uses the template-repo helper for its git workspace.
- [ ] `workflow-runner-intent.test.ts` stays green.
- [ ] `workflow-runner-core.test.ts` stays green.
- [ ] `workflow-runner-plan.test.ts` stays green.
- [ ] `workflow-runner-publication.test.ts` stays green.
- [ ] `workflow-runner-resume.test.ts` stays green.
- [ ] Test counts of `workflow-runner-intent.test.ts`, `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts`, `workflow-runner-publication.test.ts`, and `workflow-runner-core.test.ts` all remain unchanged or higher versus the merge base.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass.
- [ ] `bun run check` passes.
- [ ] `v2/docs/test-writing.md` records `bun run test:cost` before/after per-file times for `intent-output`, `write-loop-intent-landing`, and `workflow-runner-intent`, with "before" measured at the merge base.

## Documentation updates

- `v2/docs/test-writing.md` — `bun run test:cost` before/after per-test file times for the three converted files, "before" measured at the merge base.
