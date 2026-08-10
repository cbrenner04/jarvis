---
name: mutation-checkpoint-parser-requires-directive-token-first
---

# Require the directive token first in mutation-checkpoint comments

## Surface

- Directive-line recognition and malformed-directive reporting form one execution-loop parser surface; splitting does not apply because neither behavior is independently reviewable without the same parser gate.

## Problem

`parseMutateDirectives` treats any `//` comment containing `@mutate` as a directive candidate. Prose comments that mention the token later in the line therefore report `malformed`, fail the implement-write artifact contract, and strand the run.

## Decision ledger

- Recognize a directive only when `@mutate` is the first token after `//` and optional whitespace. Rules out treating later prose mentions as directives.
- Ignore later prose mentions without emitting directives or unparseable entries. Rules out preserving the current `malformed` diagnostic for non-directive comments.
- Continue reporting `malformed` when a directive-position token has an invalid body. Rules out silencing genuine syntax errors.
- Preserve parsing, target verification, and enclosing-test linkage for recognized directives. Rules out broad verifier or linker changes.

## Acceptance criteria

- [ ] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `ignores later prose mentions of a mutation directive`; Mutation checkpoint:
  `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts "const COMMENT_DIRECTIVE_LINE = /^\\s*\\\/\\\/\\s*@mutate(?=\\s|$)/;" -> "const COMMENT_DIRECTIVE_LINE = /^\\s*\\\/\\\/.*@mutate/;"`
  The test yields zero directives and zero unparseable entries for a Keystone-checkpoint prose comment that references `// @mutate` later in the line; it fails against the current token-anywhere gate.
- [ ] A well-formed `// @mutate <path> "<orig>" -> "<repl>"` line still parses as one directive.
- [ ] A directive-position `@mutate` token with a malformed body still reports `malformed`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document that prose mentions after other comment text are ignored and remove any rewording workaround that remains.
- `v2/docs/v1-behaviors.md` — align the implement-write mutation-checkpoint contract with directive-position recognition and retained malformed-directive reporting.

## Prerequisites
