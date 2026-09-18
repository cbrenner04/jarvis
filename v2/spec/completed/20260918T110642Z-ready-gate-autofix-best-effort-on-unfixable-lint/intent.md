---
name: ready-gate-autofix-best-effort-on-unfixable-lint
---

# Ready-gate built-in autofix is best-effort on unfixable lint

Unsplit rationale: the fix and its shared "non-zero exit after safe fixes" policy live entirely in the execution loop (`write-loop.ts` autofix + `completion-commit.ts` sibling), one module-boundary surface.

## Primary implementation surface

- execution loop (`v2/src/execution/`)

## Prerequisites

- Ready-gate bounded repair (the `write.ready-repair` reprompt path around `runReadyGateRepairIteration` in `v2/src/execution/write-loop.ts`) already consumes ready-gate failures generically, including pre-existing lint findings; it needs no change from this intent to handle findings that reach the gate after autofix.

## Behavior

- Discriminator: `runBuiltInReadyGateAutofixBiome`'s biome invocation rejects with `AsyncSubprocessError`. A defined numeric `status` (the subprocess ran and exited non-zero — e.g. an unfixable `noExcessiveCognitiveComplexity` finding) is a best-effort pass: record the unfixed findings and return normally instead of throwing. An `undefined status` (spawn-level failure — e.g. missing `biome`/`bun` binary) or `code === "ETIMEDOUT"` still throws `FixCommandError`.
- On a best-effort pass, execution proceeds to the ready gate and its bounded repair instead of settling `completion_commit_failed`.
- Built-in autofix now matches `runCompletionFormat`'s existing best-effort policy (`v2/src/execution/completion-commit.ts`): both swallow a non-zero exit that reflects applied safe fixes, and both still throw on `ETIMEDOUT`.
- A configured `fixCommand` exiting non-zero still settles a failure (unchanged — this discriminator applies only to the built-in biome path).

## Acceptance criteria

- [ ] Test: built-in autofix returns normally when biome rejects with a defined numeric `status` (unfixable finding remains) and records the findings; fails against current code.
- [ ] Test: `ETIMEDOUT` throws `FixCommandError` naming the budget.
- [ ] Test: a spawn-level failure (missing command, `status: undefined`) still throws `FixCommandError`.
- [ ] Write-loop test: changed paths with an unfixable `noExcessiveCognitiveComplexity` finding reach the ready gate and bounded repair, not `completion_commit_failed`; fails today.
- [ ] Test: configured `fixCommand` non-zero exit still settles a failure.
- [ ] `completion-commit.test.ts`'s "commits best-effort when the formatter exits non-zero (lint is enforced at the gate, not the commit)" test stays green — pins the existing policy this intent extends to the built-in ready-gate autofix.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — built-in autofix is best-effort on lint findings; only timeout and spawn failure fail it.
- `v2/docs/operator-runbook.md` § The ready gate and § Agent-written cognitive complexity — autofix failure names only timeout/spawn failure.
