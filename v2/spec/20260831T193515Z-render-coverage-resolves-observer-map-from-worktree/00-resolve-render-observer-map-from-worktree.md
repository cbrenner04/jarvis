# Resolve the render-observer map from the verification worktree

`verifyDiffDerivedMutations` resolves render-observer paths through the daemon build's static import. A branch that adds a registered prompt and its observer-map entry therefore fails `missing-render-coverage` until that entry merges and the daemon rebuilds.

## Behavior

- Read and extract the observer map as data from `shared/prompts/render-observer-tests.ts` below `input.worktreePath` for every verifier call; do not execute worktree module code in the daemon or reuse a loaded worktree module.
- Accept only a map export with string-array values whose normalized repo-relative observer paths canonically resolve within `input.worktreePath`, then run those paths through `runScopedTests(input.worktreePath, ...)`.
- Return `missing-render-coverage` at `<promptPath>:1` for a missing or empty mapping, an unreadable or invalid map source, a missing export, initialization failure, invalid map value or path, or observer tests that do not kill the sentinel body-line mutation.

## Decision ledger

- Resolve map source as unexecuted data anew from the verification worktree for each verifier call; rules out daemon execution of branch-controlled module code, process-map fallback, and stale module-cache state after an in-loop map repair.
- Accept only normalized repo-relative observer paths whose canonical targets remain under the verification worktree; rules out absolute, traversing, malformed, and symlink-escaping test paths.
- Classify every map-load and map-shape failure as `missing-render-coverage` at the changed prompt's first line; rules out leaking loader-specific failures or treating invalid coverage as coverage.
- Preserve the existing sentinel mutation, render-verification bound, and code-candidate killing-test path; rules out broadening this map-resolution fix into mutation or scheduling changes.

## Tasks

- Replace process-static render-observer lookup in `diff-derived-mutation-verifier.ts` with a fresh, data-only worktree resolution boundary that validates observer paths before worktree test execution and preserves fail-closed results.
- Add real-worktree regressions in `diff-derived-mutation-verifier.test.ts` for a branch-only map entry, fresh resolution after a same-worktree map update, no process-map fallback, invalid map failures, invalid paths, empty mapping, and an observer that misses the sentinel.
- Update the durable docs listed under **Documentation updates**.

## Acceptance criteria

- [x] `diff-derived-mutation-verifier.test.ts` drives a real worktree whose diff adds a registered prompt, a worktree-only `render-observer-tests.ts` entry absent from the process map, and a mapped observer that passes for the original prompt but fails for its sentinel body-line mutation; verification runs that worktree test and returns no surviving mutation, and the regression fails against the pre-fix static import with `missing-render-coverage`.
- [x] `diff-derived-mutation-verifier.test.ts` reuses one worktree across a map update and proves each verifier call reads the current worktree map rather than cached module state.
- [x] `diff-derived-mutation-verifier.test.ts` proves that a prompt present only in the daemon map, but absent from its worktree map, returns `missing-render-coverage` at `<promptPath>:1`; it fails against a process-map fallback.
- [x] `diff-derived-mutation-verifier.test.ts` proves an empty worktree mapping and a mapped observer that misses the sentinel each return `missing-render-coverage` at `<promptPath>:1`.
- [x] `diff-derived-mutation-verifier.test.ts` proves unreadable and syntactically invalid map source, missing map export, initialization failure, and malformed map values each fail closed as `missing-render-coverage` at `<promptPath>:1`.
- [x] `diff-derived-mutation-verifier.test.ts` proves absolute, traversing, non-normalized, and worktree-escaping observer paths fail closed as `missing-render-coverage` at `<promptPath>:1` without running an out-of-worktree test.
- [x] `v2/docs/write-behavior.md` is the canonical render-coverage contract: it specifies fresh data-only worktree map resolution, confined observer paths, and `missing-render-coverage` for every invalid or uncovered map state.
- [x] `v2/docs/workflow-runner.md` limits render-coverage guidance to the worktree execution boundary and links to `write-behavior.md` for the canonical contract.
- [x] `v2/docs/operator-runbook.md` § Gate trust limits guidance to salvage: a branch map repair needs neither merge nor daemon rebuild, and links to `write-behavior.md` for the contract.
- [x] `v2/docs/v1-behaviors.md` tersely records worktree-resolved render-observer lookup rather than process-static lookup.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — canonical worktree map-resolution, validation, and failure contract.
- `v2/docs/operator-runbook.md` — salvage-only branch-map repair guidance linking to the canonical contract.
- `v2/docs/workflow-runner.md` — execution-boundary guidance linking to the canonical contract.
- `v2/docs/v1-behaviors.md` — update the v1 parity baseline with worktree-resolved map lookup.
