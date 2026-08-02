---
name: tui-command-language
---

# Typed TUI command language

## Problem

The dock has no tokenizer or parser, so input cannot become a testable command or a precise error.

## Decisions

- Parse with a pure tokenizer/parser into typed `start`, `expand`, and `collapse` commands — rules out parsing inside ink callbacks or dispatch code.
- Mirror pipeline-start seed exclusivity and quoted seed text — rules out a TUI-only launch grammar.
- Return named errors for malformed input, unknown verbs, and recognized unavailable verbs — rules out exceptions and silent acceptance.
- Recognize `approve`, `reject`, `resume`, `kill`, `pause`, and `log` as unavailable with their CLI equivalents — rules out unknown-verb errors and runtime slice labels.
- Keep steering, history, and completion out of scope — rules out expanding the language beyond its first consumers.

## Acceptance criteria

- [ ] The pure parser returns typed commands for `start jarvis --seed v2/spec/seeds/foo.md`, `start jarvis --seed-text "ship it"`, `expand`, and `collapse`.
- [ ] It returns distinct named errors for an unknown verb, missing project, both seed flags, missing seed value, extra positionals, and an unterminated quote.
- [ ] `approve`, `reject`, `resume`, `kill`, `pause`, and `log` return a recognized-unavailable error naming the matching `jarvis` CLI command.
- [ ] Quoted and escaped seed text tokenizes without losing whitespace intended for the seed payload.
- [ ] `tui-command-parser.test.ts` contains a `// @mutate` directive targeting the real unknown-verb rejection guard; accepting the verb turns that test RED and no production inversion hook exists.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — the parser is internal until dock submission consumes it.

## Prerequisites
