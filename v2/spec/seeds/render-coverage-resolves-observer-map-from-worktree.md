---
name: render-coverage-resolves-observer-map-from-worktree
---

# Render-coverage gate resolves the observer map from the worktree, not the daemon build

## Problem

A PR that introduces a new registered prompt can never pass the in-daemon diff-derived render-coverage gate, even when it adds the correct render-observer map entry and a real observer test in the same PR.

`verifyDiffDerivedMutations` (`v2/src/execution/diff-derived-mutation-verifier.ts`) statically imports `resolveRenderObserverTests` from `shared/prompts/render-observer-tests.ts`. That import is compiled into the daemon build, so `verifyChangedPrompts` resolves the observer map from the daemon's own source tree (`main`), not from the branch worktree under test. When the new prompt is a changed path in the diff, `resolveRenderObserverTests(promptPath)` returns `undefined` (the entry exists only on the branch) and the verifier returns `missing-render-coverage` immediately — it never reads the worktree map and never runs the observer test.

This is a bootstrapping trap: the map entry must be on `main` (and the daemon rebuilt) for the verifier to see it, but the entry is *in the same PR* that adds the prompt. `jarvis run resume` cannot clear it — the daemon build is fixed for that daemon's life. Same defect class as the dispatch-parity family ("assembled/resolved twice, one copy stale"): daemon-build data shadowing worktree data.

## Evidence

- Run `640a5777` / PR #3197 (`implement-verifies-mutations-in-loop`) added `prompts/write/surviving-mutation-reprompt.md` + its `render-observer-tests.ts` entry + an observer test in `v2/src/execution/write-prompt.test.ts`. Resume committed the fix (branch HEAD `5bad9441`) and re-verified; it still settled `surviving_mutation_failed` / `missing-render-coverage` at `prompts/write/surviving-mutation-reprompt.md:1`.
- Hand-reproduced the verifier's exact mutation (`mutateRenderedPrompt` replaces the first non-empty body line with the sentinel) against the branch worktree and ran the mapped observer test: it goes red (1 fail), i.e. coverage is genuinely correct. `main`'s `render-observer-tests.ts` has zero entries for the new prompt — proving the daemon build, not the branch, is what the verifier reads.
- Consistent with every new-prompt implement this session being hand-published rather than harness-landed.

## Decisions

- The render-coverage check must resolve the observer map from the **worktree under test** at runtime (read/parse `shared/prompts/render-observer-tests.ts` under `input.worktreePath`), not from the daemon's statically-imported copy — so a PR that atomically adds a prompt and its map entry can pass its own gate.
- Killing-test resolution for code candidates already runs the worktree's tests via `runScopedTests(input.worktreePath, …)`; render-coverage should be symmetric — worktree map + worktree observer tests.
- Fail-closed unchanged: a worktree with no entry (or an entry whose observer test does not catch the sentinel mutation) still returns `missing-render-coverage`.
- Out of scope: changing the mutation shape (`mutateRenderedPrompt`), the `MAX_PROMPT_RENDER_VERIFICATIONS` bound, or killing-test resolution for code candidates.

## Acceptance criteria

- [ ] A `verifyDiffDerivedMutations` regression drives a worktree whose diff adds a new registered prompt AND a `render-observer-tests.ts` entry mapping it to an observer test that catches the sentinel body-line mutation; the verifier resolves the entry from the worktree map and returns no surviving mutation. It fails against the pre-fix static-import derivation (which returns `missing-render-coverage`).
- [ ] A regression asserts fail-closed: the same new-prompt diff with the worktree map entry absent (or present but mapped to an observer test that does not assert on the mutated body line) still returns `missing-render-coverage` at `<promptPath>:1`.
- [ ] A regression asserts the verifier reads the map from `input.worktreePath`, not the process's own `shared/prompts/render-observer-tests.ts` (e.g. a worktree entry the daemon build lacks is honored).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `missing-render-coverage` salvage note (§ Diff-derived verification / Gate trust) should state the worktree-resolved contract and drop the implicit assumption that a branch map entry suffices only after merge.
- `v2/docs/workflow-runner.md` — render-coverage resolution reads the worktree observer map (parity with worktree killing-test resolution).
