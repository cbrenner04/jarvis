# 00 - Typed TUI command language

## Problem

The command dock has no pure language boundary, so input cannot become a typed command or precise parse error.

## Decisions

- Parse command text in a pure TUI module — rules out parsing in Ink callbacks, monitor controls, or dispatch code.
- Return discriminated `start`, `expand`, and `collapse` commands; `start` preserves project plus exclusive path/text seed mode and value — rules out untyped token arrays or collapsing both seeds into one ambiguous string.
- Support this canonical TUI subset, not full CLI parity: `start <project> (--seed <value> | --seed-text <value>)`; the project is the first token after `start`, the one seed flag follows it, and no other token forms are accepted. `--seed=value`, duplicate seed flags, `--`, unknown options, and flag-looking seed values are rejected; a flag-looking value is missing rather than a seed payload — rules out inheriting unspecified CLI option behavior.
- Tokenize unquoted whitespace as separators, strip matching double quotes, and concatenate adjacent quoted/unquoted segments into one token. A backslash removes itself only before whitespace, `"`, or `\\`, preserving that literal character; an unsupported escape and a trailing backslash remain literal. Empty quotes produce an empty token — rules out naive whitespace splitting or retaining syntax characters in seed text.
- Reject an unterminated double quote as a named tokenizer error — rules out silently consuming incomplete input.
- Require `expand` and `collapse` to have no operands or options; any trailing token is rejected — rules out ignored arguments.
- Export errors with these stable `code` discriminants: `malformed_input`, `unterminated_quote`, `unknown_verb`, `recognized_unavailable`, `missing_project`, `missing_seed_choice`, `missing_seed_value`, `both_seed_flags`, `duplicate_seed_flag`, `unknown_option`, `extra_positional`, and `unexpected_arguments`. Defer display text and incidental fields; `recognized_unavailable` carries its CLI-equivalent command — rules out exceptions, generic usage failures, or an unstable typed contract.
- Resolve errors deterministically: tokenize first; then reject empty input; then classify the verb. A successfully tokenized unavailable verb always returns `recognized_unavailable`, regardless of trailing tokens. For `start`, check project presence, scan remaining tokens left-to-right (a seed flag with no immediate non-flag value is `missing_seed_value`; unsupported option forms are `unknown_option`; other tokens are `extra_positional`), then reject duplicate seed flags before both seed flags, then reject a missing seed choice — rules out incidental validation order.
- Classify `approve`, `reject`, `resume`, `kill`, `pause`, and `log` as recognized but unavailable, carrying `jarvis pipeline approve`, `jarvis pipeline reject`, `jarvis pipeline resume`, `jarvis run kill`, `jarvis run pause`, and `jarvis tui log` respectively — rules out unknown-verb feedback or runtime slice labels.
- Keep steering arguments, dispatch, history, completion, and multiline editing out of scope — rules out expanding this parser beyond its first typed consumers.
- Deferred to first consumer: exact result field names and operator-facing error formatting — pin when a caller needs it.

## Work

- Add a pure TUI tokenizer/parser and exported command/error types.
- Add focused table-driven parser tests covering the canonical grammar, error precedence, tokenizer preservation, and every error code.
- Put a unique valid source-text mutation directive in the pinning tests for every added or modified parser guard; target the real condition and add no production inversion hooks.

## Acceptance criteria

- [x] `tui-command-parser.test.ts` adds parser regressions that fail against the pre-change baseline and pass after implementation: `start jarvis --seed v2/spec/seeds/foo.md`, `start jarvis --seed-text "ship it"`, `expand`, and `collapse` return their typed commands with seed mode and payload preserved.
- [x] `tui-command-parser.test.ts` proves the canonical `start` subset: seed flags follow the project; `--seed=value`, duplicate flags, `--`, unknown options, and flag-looking values return their specified error codes rather than being accepted or reinterpreted.
- [x] `tui-command-parser.test.ts` proves double-quoted whitespace, empty quotes, adjacent quoted/unquoted segments, escaped whitespace/quotes/backslashes, unsupported escapes, and trailing backslashes tokenize with the specified payload preservation and syntax removal.
- [x] `tui-command-parser.test.ts` proves the exported `code` discriminants for unknown verb, malformed/empty input, missing project, missing seed choice/value, both seed flags, duplicate seed flags, unknown options, extra positionals, unexpected arguments, and unterminated quote; it also pins the specified tokenizer, verb, and `start` validation precedence without throwing.
- [x] `tui-command-parser.test.ts` proves `expand` and `collapse` reject every operand or option with `unexpected_arguments`.
- [x] `tui-command-parser.test.ts` proves `approve`, `reject`, `resume`, `kill`, `pause`, and `log` always return `recognized_unavailable` after successful tokenization, including with trailing tokens, carrying their exact existing CLI command equivalents and no runtime planning labels.
- [x] `tui-command-parser.test.ts` carries a unique valid `// @mutate` directive for every added or modified conditional guard, including the real unknown-verb rejection guard; every directive targets a unique real condition, applying each mutation makes the scoped suite fail, normal production rejects invalid input, and production contains no inversion hook.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — this pure parser has no operator or cross-file runtime contract until dock submission consumes it.
