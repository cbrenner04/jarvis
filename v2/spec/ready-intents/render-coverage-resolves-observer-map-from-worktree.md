---
name: render-coverage-resolves-observer-map-from-worktree
---

# Render-coverage gate resolves the observer map from the worktree

Unsplit rationale: The fix, regressions, and durable documentation all live on the execution-loop diff-derived mutation verifier surface; no other module-boundary surface owns render-coverage map resolution.

## Primary implementation surface

- Execution-loop diff-derived mutation verification in `v2/src/execution/`

## Prerequisites

- Diff-derived verification resolves per-candidate killing tests from the worktree under test via `runScopedTests(input.worktreePath, …)`.
- `shared/prompts/render-observer-tests.ts` maps registry-relative `prompts/...` paths to repo-relative observer test file paths for `bun test`.

## Problem

- `verifyDiffDerivedMutations` statically imports `resolveRenderObserverTests`, so the daemon build's map shadows the branch worktree under test.
- A PR that atomically adds a registered prompt and its render-observer map entry always settles `missing-render-coverage` until the map merges to `main` and the daemon rebuilds.

## Behavior

- Render-coverage resolves observer test scope from `shared/prompts/render-observer-tests.ts` under `input.worktreePath` at verification time, then runs those worktree observer tests via `runScopedTests(input.worktreePath, …)`.
- Missing map entry, empty mapping, or an observer test that does not catch the sentinel body-line mutation still returns `missing-render-coverage` at `<promptPath>:1`.

## Decision ledger

- Resolve the render-observer map from `input.worktreePath` at runtime instead of the process static import; rules out daemon-build map shadowing branch-only entries.
- Keep fail-closed `missing-render-coverage` when the worktree lacks a map entry or the mapped observer test does not kill the sentinel mutation; rules out passing uncovered prompt changes.
- Out of scope: `mutateRenderedPrompt` shape, `MAX_PROMPT_RENDER_VERIFICATIONS`, and code-candidate killing-test resolution.

## Acceptance criteria

- [ ] A `diff-derived-mutation-verifier.test.ts` regression drives a worktree whose diff adds a new registered prompt and a worktree-only `render-observer-tests.ts` entry (absent from the process map) mapping it to an observer test that catches the sentinel body-line mutation; the verifier resolves from the worktree map, not the process static import, and returns no surviving mutation; it fails against the pre-fix static-import derivation (`missing-render-coverage`).
- [ ] A regression in `diff-derived-mutation-verifier.test.ts` asserts fail-closed for the same new-prompt worktree fixture when the map entry is present but maps to an observer test that does not assert on the mutated body line, or when the mapping is empty; still returns `missing-render-coverage` at `<promptPath>:1`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `missing-render-coverage` salvage note (§ Diff-derived verification / Gate trust) states the worktree-resolved contract and drops the implicit assumption that a branch map entry suffices only after merge.
- `v2/docs/workflow-runner.md` — render-coverage resolution reads the worktree observer map (parity with worktree killing-test resolution).
- `v2/docs/write-behavior.md` — diff-derived verifier paragraph states render-coverage resolves the observer map from the worktree under test.
- `v2/docs/v1-behaviors.md` — record that diff-derived render-coverage resolves the observer map from the worktree under test, not the daemon build.
