# Require directive token first

`parseMutateDirectives` currently treats any `//` comment containing `@mutate` as a directive candidate, so later prose mentions report `malformed` and can block implement completion.

## Decisions

- Recognize directives only when `@mutate` is the first token after `//` and optional whitespace; rules out treating later prose mentions as directives.
- Ignore later prose mentions without directives or unparseable entries; rules out retaining `malformed` diagnostics for non-directive comments.
- Report `malformed` when a directive-position `@mutate` token has an invalid body; rules out silencing genuine syntax errors.
- Preserve parsing, target verification, and enclosing-test linkage for recognized directives; rules out broader verifier or linker changes.

## Tasks

- Narrow the comment-candidate gate to directive-position `@mutate` tokens with a token boundary.
- Add parser coverage for ignored later prose mentions while retaining well-formed and malformed directive-position coverage.
- Align the operator runbook and v1 behavior catalog with directive-position recognition and retained malformed reporting.

## Acceptance criteria

- [ ] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `ignores later prose mentions of a mutation directive`; Keystone checkpoint: the test yields zero directives and zero unparseable entries for a comment that references `// @mutate` after other prose, fails against the pre-fix token-anywhere gate, and contains `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts "const COMMENT_DIRECTIVE_LINE = /^\\s*\\\/\\\/\\s*@mutate(?=\\s|$)/;" -> "const COMMENT_DIRECTIVE_LINE = /^\\s*\\\/\\\/.*@mutate/;"` so reverting the directive-position guard turns the test red.
- [ ] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `parses path, original, replacement, and enclosing pin title` and `a malformed directive is reported, not silently dropped` stay green, preserving recognized directive parsing and directive-position malformed reporting.
- [ ] `v2/docs/operator-runbook.md` states that later prose mentions are ignored and removes any rewording workaround; `v2/docs/v1-behaviors.md` records directive-position recognition and retained malformed reporting.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/operator-runbook.md` — document ignored later prose mentions and remove any rewording workaround.
- `v2/docs/v1-behaviors.md` — record directive-position recognition and retained malformed-directive reporting in the implement-write mutation-checkpoint contract.
