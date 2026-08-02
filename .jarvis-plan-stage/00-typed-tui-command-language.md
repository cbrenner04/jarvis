# 00 - Typed TUI command language

## Problem

The command dock has no pure language boundary, so input cannot become a typed command or precise parse error.

## Decisions

- Parse command text in a pure TUI module — rules out parsing in Ink callbacks, monitor controls, or dispatch code.
- Return discriminated `start`, `expand`, and `collapse` commands; `start` preserves project plus exclusive path/text seed mode and value — rules out untyped token arrays or collapsing both seeds into one ambiguous string.
- Tokenize unquoted whitespace as separators, strip matching double quotes, and let backslash preserve the following whitespace, quote, or backslash in a token — rules out naive whitespace splitting or retaining syntax characters in seed text.
- Reject an unterminated double quote as a named tokenizer error — rules out silently consuming incomplete input.
- Require `start <project>` with exactly one of `--seed <path>` and `--seed-text <text>` and no extra positionals — rules out TUI-only precedence, implicit projects, or ignored arguments.
- Return typed named errors instead of throwing: malformed/empty input, unknown verb, missing project, missing seed choice/value, both seed flags, extra positionals, and unterminated quote — rules out exceptions or one generic usage failure.
- Classify `approve`, `reject`, `resume`, `kill`, `pause`, and `log` as recognized but unavailable, carrying `jarvis pipeline approve`, `jarvis pipeline reject`, `jarvis pipeline resume`, `jarvis run kill`, `jarvis run pause`, and `jarvis tui log` respectively — rules out unknown-verb feedback or runtime slice labels.
- Keep steering arguments, dispatch, history, completion, and multiline editing out of scope — rules out expanding this parser beyond its first typed consumers.
- Deferred to first consumer: exact result field names and operator-facing error formatting — pin when a caller needs it.

## Work

- Add a pure TUI tokenizer/parser and exported command/error types.
- Add focused table-driven parser tests covering commands, seed grammar, token preservation, and every error family.
- Put source-text mutation directives in the pinning tests for every added parser guard; target the real conditions and add no production inversion hooks.

## Acceptance criteria

- [ ] `tui-command-parser.test.ts` adds parser regressions that fail against the pre-change baseline and pass after implementation: `start jarvis --seed v2/spec/seeds/foo.md`, `start jarvis --seed-text "ship it"`, `expand`, and `collapse` return their typed commands with seed mode and payload preserved.
- [ ] `tui-command-parser.test.ts` proves double-quoted whitespace plus backslash-escaped whitespace, quotes, and backslashes survive in the seed payload without syntax characters or separators being lost.
- [ ] `tui-command-parser.test.ts` proves unknown verb, malformed/empty input, missing project, missing seed choice, both seed flags, missing seed value, extra positionals, and unterminated quote return distinct named errors without throwing.
- [ ] `tui-command-parser.test.ts` proves `approve`, `reject`, `resume`, `kill`, `pause`, and `log` return recognized-unavailable errors carrying their exact existing CLI command equivalents and no runtime planning labels.
- [ ] `tui-command-parser.test.ts` carries a valid `// @mutate` directive for every added conditional guard, including the real unknown-verb rejection guard; each source target is unique, applying each mutation turns its pinning test red, suppressed invalid commands remain unaccepted, and production contains no inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — this pure parser has no operator or cross-file runtime contract until dock submission consumes it.
