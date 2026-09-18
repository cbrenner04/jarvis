---
name: ready-gate-autofix-best-effort-on-unfixable-lint
---

# Ready-gate built-in autofix is best-effort on unfixable lint

Unsplit rationale: the fix and its shared "non-zero exit after safe fixes" policy live entirely in the execution loop (`write-loop.ts` autofix + `completion-commit.ts` sibling), one module-boundary surface.

## Primary implementation surface

- execution loop (`v2/src/execution/`)

## Prerequisites

## Behavior

- `runBuiltInReadyGateAutofixBiome` treats biome's non-zero exit for non-autofixable findings as a successful best-effort pass, records the unfixed findings, and proceeds to the ready gate and its bounded repair instead of settling `completion_commit_failed`.
- `ETIMEDOUT`, spawn failure, or missing command still throw `FixCommandError`.
- Built-in autofix and `runCompletionFormat` share one policy for "exited non-zero but applied safe fixes".
- A configured `fixCommand` exiting non-zero still settles a failure.

## Acceptance criteria

- [ ] Test: built-in autofix returns normally when biome exits non-zero with an unfixable finding remaining; fails against current code.
- [ ] Test: `ETIMEDOUT` throws `FixCommandError` naming the budget.
- [ ] Test: spawn failure (missing command) still throws.
- [ ] Write-loop test: changed paths with an unfixable `noExcessiveCognitiveComplexity` finding reach the ready gate and bounded repair, not `completion_commit_failed`; fails today.
- [ ] Test: configured `fixCommand` non-zero exit still settles a failure.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — built-in autofix is best-effort on lint findings; only timeout and spawn failure fail it.
- `v2/docs/operator-runbook.md` § The ready gate and § Agent-written cognitive complexity — autofix failure names only timeout/spawn failure.
