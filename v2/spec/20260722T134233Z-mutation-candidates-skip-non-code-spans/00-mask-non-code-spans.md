# 00 - Mask string, template, and comment spans out of mutation candidates

## Problem

`deriveFromLine` in `v2/src/execution/diff-derived-mutation-verifier.ts` runs `deriveGuardMutations`,
`deriveOperatorMutations`, and `deriveDestructiveMutations` over the raw text of a changed line, so
characters inside string literals, template literals, and comments become mutation candidates. Its
only filter is a whole-line comment check (`content.trim().startsWith("//")`).

Observed 2026-07-21 (`d8128993-85e5-485a-8ee6-67dfd15e7133`): `v2/src/cli/usage.ts:16` holds
`export const CLEANUP_USAGE = "usage: jarvis cleanup [--dry-run] [--yes|-y] [--abandon <name>]\n";`.
The `<` in the `<name>` placeholder was flipped to `>=`; no test can kill a mutation in usage prose,
so the run reported `surviving_mutation_failed` against correct work (PR #1908).

`applyMutation` compounds this: it rewrites the line with `line.replace(candidate.originalText, …)`,
which hits the first textual occurrence rather than the candidate's recorded columns. Even with
correct candidates, an operator on a line whose string literal contains an earlier `<` would be
applied inside the string.

## Decisions

- Mask string literals, template literals, and comments to a filler character before deriving candidates, preserving line length and column offsets; rules out returning span ranges the three derivers each have to filter against.
- Lex the line character by character tracking quote/template/comment state with escape handling; rules out a regex "inside quotes?" heuristic that breaks on escapes and mixed quote styles.
- All three derivers (guard, operator, destructive) consume the masked line; rules out masking only comparison operators and leaving `!` and `delete(` inside prose still mutable.
- Masking is line-scoped: an unterminated opening quote or template masks to end of line, and a line that is the interior or tail of a multi-line template literal or block comment is still lexed as code. The verifier only ever holds one changed line's text, so multi-line state is not available; rules out claiming file-scoped correctness this change does not deliver.
- `applyMutation` splices at `columnStart`/`columnEnd` instead of `String.replace`, and throws when the slice at those columns is not `originalText`; rules out mutating the wrong occurrence on a line that also contains the same characters inside a masked span.
- Keep the existing whole-line comment early return in `deriveFromLine`; masking subsumes it, but it also skips `*` continuation lines that masking cannot classify.

## Acceptance criteria

- [x] A changed line in a code file whose only `<`, `>`, `!`, or `delete(` text sits inside a string literal yields no mutation candidate. A test in `v2/src/execution/diff-derived-mutation-verifier.test.ts` drives the verifier over such a diff, asserts a `pass` with `candidateCount: 0`, and fails against the pre-change deriver.
- [x] `<` inside a trailing `//` line comment and inside a backtick template literal likewise yield no candidate, asserted by tests in the same file.
- [x] A genuine comparison operator on the same line as a string containing `<` is still mutated, and the applied mutation lands on the operator rather than inside the string — asserted by a test that inspects the written file content.
- [x] A regression test pins the exact `v2/src/cli/usage.ts` `CLEANUP_USAGE` line as a changed line and asserts it produces no candidate; it fails against the pre-change verifier.
- [x] Escaped quotes (`"a \" b < c"`) and single-quoted strings adjacent to real operators are masked correctly, asserted by a test.
- [x] Existing `v2/src/execution/diff-derived-mutation-verifier.test.ts` tests stay green (candidate derivation, scoped-test execution, restoration, bounds, and result semantics unchanged).
- [x] Inverting each conditional this change adds or modifies — the masking lexer's quote-open, quote-close, escape, and comment-start branches, and `applyMutation`'s column-slice guard — fails at least one test. For the masking branches the negative case asserts the candidate is present when masking is off, proving the suppression is what removes it.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — in the completion-verification paragraph, state that code mutation candidates come from code spans of a changed line: string literals, template literals, and comments are masked out first, and masking is line-scoped.
- `v2/docs/v1-behaviors.md` — amend the diff-derived mutation evidence entry (line ~74) to record that guard, comparison-operator, and destructive-operation candidates are derived from masked code spans, not raw changed-line characters.
