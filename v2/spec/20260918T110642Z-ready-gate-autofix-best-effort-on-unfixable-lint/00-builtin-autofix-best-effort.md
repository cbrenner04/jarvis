# 00 — Built-in autofix swallows non-zero lint exit

`dispatchReadyGateAutofix`'s built-in path, `runBuiltInReadyGateAutofixBiome` (`v2/src/execution/write-loop.ts`), runs inside `publishWithReadyRepair` after the ready gate has already failed and entered repair. It throws `FixCommandError` on any biome rejection, so an unfixable finding (e.g. `noExcessiveCognitiveComplexity`) makes `publishWithReadyRepair` settle `completion_commit_failed` instead of continuing to typecheck verification and, on a still-active gate failure, the bounded `write.ready-repair` reprompt loop.

## Decisions

- Discriminate on `AsyncSubprocessError`: defined numeric `status` → best-effort pass (return normally, no throw); `code === "ETIMEDOUT"` or `status === undefined` → throw `FixCommandError` as today. The invocation is `bun biome check --write --unsafe ...`, so a missing `biome`, a bad config, or a biome crash all exit `bun` with a defined numeric status and become a best-effort pass — reaching the ready gate and bounded repair rather than shipping silently. Only a missing `bun` executable is a spawn-level failure (`status: undefined`). Rules out treating a missing `bun` as best-effort (would silently skip autofix with no repair signal).
- Scope is the built-in biome path only; configured/injected `fixCommand` non-zero exit still fails. Rules out routing both through the new policy.
- Mirrors `runCompletionFormat` (`v2/src/execution/completion-commit.ts`); no shared helper extraction — not required by this change.

## Acceptance criteria

- [ ] Test in `write-loop.test.ts`: built-in autofix returns normally when the runner rejects with `AsyncSubprocessError` carrying a defined numeric `status`; fails against the pre-fix code.
- [ ] Test: `ETIMEDOUT` rejection throws `FixCommandError` naming the `timeoutMs` budget.
- [ ] Test: rejection with `status: undefined` (missing `bun`) throws `FixCommandError`.
- [ ] Write-loop test: `publishWithReadyRepair`, given changed paths with an unfixable `noExcessiveCognitiveComplexity` finding, returns no `completion_commit_failed` failure and dispatches a `write.ready-repair` reprompt iteration instead; fails against the pre-fix code.
- [ ] New test: a configured `fixCommand` exiting non-zero still settles a failure (no existing test pins this).
- [ ] `v2/src/execution/completion-commit.test.ts` "commits best-effort when the formatter exits non-zero (lint is enforced at the gate, not the commit)" stays green — pins the policy this change extends to the built-in path.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md` (§ The ready gate, § Agent-written cognitive complexity), and the `v2/docs/v1-behaviors.md` "Ready-gate repair autofix" entry (the paragraph starting "on every red gate entering repair") state built-in autofix fails only on timeout, a missing `bun` (spawn failure), or a signal kill — everything else is best-effort.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — built-in autofix best-effort; only timeout, spawn failure, or signal kill fail it.
- `v2/docs/operator-runbook.md` § The ready gate and § Agent-written cognitive complexity — autofix failure names only timeout, spawn failure, or signal kill.
- `v2/docs/v1-behaviors.md` — update the "Ready-gate repair autofix" entry (`v2/docs/v1-behaviors.md` around line 601): the built-in biome path is now best-effort on a non-zero exit; "fix-command failure settles retryable `completion_commit_failed`" remains true only for the configured `fixCommand` path.
