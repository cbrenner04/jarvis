# The mutation verifier flips operators inside string literals

## Problem

The diff-derived mutation verifier applies comparison-operator flips to `<` characters that sit
inside **string literals in TypeScript source**, not just in Markdown prose. No test can kill such a
mutation, so it survives and fails the run.

Observed 2026-07-21 on the `cleanup-non-interactive-confirm-flag` implement run
(`d8128993-85e5-485a-8ee6-67dfd15e7133`), which changed `v2/src/cli/usage.ts`:

```text
loopOutcomeKind: surviving_mutation_failed
survivingMutation: operator-flip: < → >=
survivingMutationSourceFile: v2/src/cli/usage.ts
survivingMutationSourceLine: 16
```

Line 16 is a usage string:

```ts
export const CLEANUP_USAGE = "usage: jarvis cleanup [--dry-run] [--yes|-y] [--abandon <name>]\n";
```

The `<` in `<name>` is a placeholder inside a string literal. The verifier mutated it to `>=name>`
and reported the run failed. The implementation was correct, fully ticked, CI-green, and merged as
PR #1908 over the gate.

`prompt-changes-require-render-coverage`
(`v2/spec/20260721T225653Z-prompt-changes-require-render-coverage/`) **does not cover this.** That
work classifies changed paths by *file kind* — code, registered prompt, other — and keeps the full
code mutation catalog for code. `usage.ts` is code, so file-kind classification leaves this case
exactly as it is today.

## Decisions

- Skip operator mutation of characters inside string literals, template literals, and comments; the
  operator catalog applies to *code tokens*, not to every matching character in a code file. Rules
  out treating a file's kind as sufficient to decide which spans are mutable.
- Determine mutable spans by lexing the source, not by regex over raw lines. Rules out an
  ad-hoc "is this inside quotes" heuristic that breaks on escapes and nested quotes.
- Keep every existing mutation on genuine code operators. Rules out narrowing the catalog or
  excluding files that merely happen to contain usage strings.
- Do not add a suppression comment or per-file opt-out. Rules out pushing the workaround onto
  implementers.

## Acceptance criteria

- [ ] A diff whose only `<` characters are inside string literals yields no comparison-operator
      mutation candidate.
- [ ] Regression coverage pins the `v2/src/cli/usage.ts:16` `CLEANUP_USAGE` case specifically, and
      fails against the current verifier.
- [ ] `<` inside a line comment and inside a template literal are likewise not mutated.
- [ ] A genuine comparison operator on the same line as a string containing `<` is still mutated.
- [ ] Existing code-path mutation candidates, scoped-test execution, restoration, bounds, and result
      semantics are unchanged.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — mutation candidates come from code tokens, not raw characters.
