# Require directive token first

`parseMutateDirectives` currently treats any `//` comment containing `@mutate` as a directive candidate, so later prose mentions report `malformed` and can block implement completion.

## Decisions

- Recognize directives only when `@mutate` is the first token after `//` and optional whitespace, with a token boundary so lookalike tokens (`@mutated`, `@mutateSuffix`) do not match; rules out treating later prose mentions, and lookalike tokens, as directives.
- Ignore later prose mentions without directives or unparseable entries; rules out retaining `malformed` diagnostics for non-directive comments.
- Report `malformed` when a directive-position `@mutate` token has an invalid body, even when the same line also contains a later well-formed-looking `@mutate … "…" -> "…"` sequence; the body-pattern match used for line parsing anchors to the directive-position token instead of searching the whole line, so a later occurrence never rescues a malformed line into a parsed directive. This anchoring is local to `parseMutateDirectives`'s line parsing; the shared `DIRECTIVE_PATTERN` used for acceptance-criterion selection is unchanged, so criterion selection elsewhere is unaffected.
- Preserve parsing, target verification, and enclosing-test linkage for recognized directives; rules out broader verifier or linker changes.

## Tasks

- Narrow the comment-candidate gate to directive-position `@mutate` tokens with a token boundary.
- Anchor line-level directive-body parsing to the directive-position token so a malformed directive-position token is not rescued by a later well-formed-looking occurrence on the same line; leave criterion-selection's `DIRECTIVE_PATTERN` usage unchanged.
- Add parser coverage for: ignored later prose mentions, ignored directive-position lookalike tokens, the malformed-first/later-marker case, and retained well-formed and malformed directive-position coverage.
- Align the operator runbook and v1 behavior catalog with directive-position recognition and ignored later prose mentions.

## Acceptance criteria

- [x] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `ignores later prose mentions of a mutation directive`; Keystone checkpoint: the test yields zero directives and zero unparseable entries for a comment that references `// @mutate` after other prose, fails against the pre-fix token-anywhere gate, and contains `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts "const COMMENT_DIRECTIVE_LINE = /^\\s*\\\/\\\/\\s*@mutate(?=\\s|$)/;" -> "const COMMENT_DIRECTIVE_LINE = /^\\s*\\\/\\\/.*@mutate/;"` so reverting the directive-position guard turns the test red.
- [x] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `ignores a directive-position lookalike token`; Mutation checkpoint: the test yields zero directives and zero unparseable entries for a comment whose first token after `//` is `@mutated` (or another `@mutate`-prefixed lookalike, e.g. `@mutateSuffix`), and carries a directive that drops only the token-boundary lookahead (for example replacing `@mutate(?=\s|$)` with `@mutate` in the line gate) so the boundary requirement alone is provably guarded, distinct from the anchoring checkpoint above.
- [x] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `a malformed directive-position token is not rescued by a later well-formed-looking occurrence`; Mutation checkpoint: for a line whose directive-position `@mutate` token has an invalid body followed later in the same line by a well-formed-looking `@mutate <path> "<original>" -> "<replacement>"` sequence, the parser reports one `malformed` unparseable entry and zero directives; carries a directive reverting the line-parsing anchor to an unanchored whole-line search so the case is provably guarded.
- [x] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `parses path, original, replacement, and enclosing pin title` and `a malformed directive is reported, not silently dropped` stay green, preserving recognized directive parsing and directive-position malformed reporting.
- [x] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `only directives under a named pin are linked to that criterion` stays green, preserving enclosing-test linkage.
- [x] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `target text absent` and `target text ambiguous` (in the `unparseable causes are reported from opened pinning files` block) stay green, preserving target verification for recognized directives.
- [x] `v2/src/execution/mutation-checkpoint-verifier.test.ts` — `prose @mutate without a directive-shaped occurrence is not selected` and `canonical suffix template quoted as contract prose does not select` stay green, confirming acceptance-criterion selection via the shared `DIRECTIVE_PATTERN` is unaffected by the line-parsing anchor change.
- [x] `v2/docs/operator-runbook.md` states that later prose mentions and directive-position lookalike tokens are ignored; `v2/docs/v1-behaviors.md` records directive-position recognition and retained malformed reporting.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/operator-runbook.md` — document that later prose mentions and directive-position lookalike tokens are ignored.
- `v2/docs/v1-behaviors.md` — record directive-position recognition and retained malformed-directive reporting in the implement-write mutation-checkpoint contract.
