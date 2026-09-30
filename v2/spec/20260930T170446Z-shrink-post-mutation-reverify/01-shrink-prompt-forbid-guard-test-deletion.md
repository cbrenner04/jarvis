# Shrink prompt forbids deleting guard killing tests

## Problem

`prompts/implement/shrink.md` tells agents to prefer deletion and does not forbid removing co-located killing tests for changed guards. Harness enforcement belongs in mutation re-verification (subspec 00), but shrink step rules and prompt prose should still state the constraint so agents see it in `STEP_RULES` and the shrink template.

## Decision ledger

- Add an explicit shrink-only step rule forbidding deletion or emptying of co-located killing tests (`<stem>.test.ts`, `<stem>-*.test.ts`) that cover changed guards, appended only on the hidden shrink write-loop input; rules out adding that prohibition to `IMPLEMENT_WRITE_STEP_RULES` for every implement iteration.
- Mirror the same prohibition in `prompts/implement/shrink.md` § Rules; rules out prompt-only wording without the injected step rule called out in `v2/docs/write-behavior.md` placeholder table.

## Task checklist

- Define a concise shrink-only step-rule string (shared between workflow shrink dispatch and tests) and thread it into the shrink `WriteLoopInput.stepRules` built in `workflow-runner.ts` for `runShrinkAfterImplementComplete`.
- Add a § Rules bullet to `prompts/implement/shrink.md` aligned with that step rule.
- Extend `write-prompt.test.ts` (or `write.test.ts` shrink prompt case) to pin the rule in rendered `implement.prompt.shrink` output including the `<STEP_RULES>` block.

## Acceptance criteria

- [ ] `write-prompt.test.ts` asserts rendered `implement.prompt.shrink` includes the guard-test deletion prohibition in both the markdown Rules section and the final `STEP_RULES` block; fails against the pre-fix prompt and stepRules wiring.
- [ ] `write.test.ts` `"implement.prompt.shrink renders DEFAULT_WRITE_STEP_RULES as final block"` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes (root `prompts/` is outside the scoped surfaces in `scripts/ci-test-scope.ts`, so the full suite is the scoped gate).

## Documentation updates

- `prompts/implement/shrink.md` — Rules forbid deleting tests that cover changed guards.
- `v2/docs/prompt-governance.md` — one line noting shrink step rules carry the guard-test deletion constraint (if not already evident from `prompts.md`).
