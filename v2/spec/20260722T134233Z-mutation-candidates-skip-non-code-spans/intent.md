---
name: mutation-candidates-skip-non-code-spans
---

# Mutation candidates come from code tokens, not raw characters

## Problem

The diff-derived mutation verifier derives operator flips by scanning raw characters of a changed
line, so a `<` inside a string literal becomes a mutation candidate. No test can kill it, so the run
fails on a correct implementation.

Observed 2026-07-21 (`d8128993-85e5-485a-8ee6-67dfd15e7133`): `v2/src/cli/usage.ts:16` holds
`export const CLEANUP_USAGE = "usage: jarvis cleanup [--dry-run] [--yes|-y] [--abandon <name>]\n";`
The `<` in the `<name>` placeholder was mutated to `>=`, reported `surviving_mutation_failed`, and
the correct work (PR #1908) merged over the gate.

File-kind classification (`prompt-changes-require-render-coverage`) does not help: `usage.ts` is
code, so the full code catalog still applies to it.

## Decisions

- Mask string literals, template literals, and comments out of a changed line before deriving
  mutation candidates. Rules out treating file kind as sufficient to decide which spans are mutable.
- Determine those spans by lexing the line, not by regex over raw text. Rules out an ad-hoc
  "inside quotes?" heuristic that breaks on escapes and mixed quote styles.
- Keep every existing mutation on genuine code operators, including operators elsewhere on a line
  that also contains a masked span. Rules out narrowing the catalog or skipping whole files.
- No suppression comment or per-file opt-out. Rules out pushing the workaround onto implementers.

## Acceptance criteria

- [ ] A changed line whose only `<` characters sit inside a string literal yields no
      comparison-operator mutation candidate.
- [ ] `<` inside a line comment and inside a template literal likewise yield no candidate.
- [ ] A genuine comparison operator on the same line as a string containing `<` is still mutated.
- [ ] Regression coverage pins the `v2/src/cli/usage.ts` `CLEANUP_USAGE` line specifically and fails
      against the pre-change verifier.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` stays green (candidate derivation,
      scoped-test execution, restoration, bounds, and result semantics unchanged).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — mutation candidates come from code tokens, not raw characters.

## Prerequisites

- The diff-derived mutation verifier derives operator-flip candidates from changed lines in code files.
