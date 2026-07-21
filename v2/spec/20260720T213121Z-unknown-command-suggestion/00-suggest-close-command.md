# Suggest one close top-level command

Unknown v2 commands should direct operators to canonical help and offer one unambiguous typo correction when available.

## Decisions

- Use Levenshtein distance at most 2, including insertion, deletion, and substitution; rules out implementation-dependent fuzzy matching.
- Suggest only when exactly one registered top-level name qualifies; rules out selecting the first ambiguous match.
- Read candidates from the top-level command registry; rules out a second command-name list or subcommand suggestions.
- Preserve `unknown command: <input>`, followed by any suggestion and then `jarvis help` guidance, only on stderr with exit 1; rules out successful help output on stdout or lost error context.
- Remove the recognized-command enumeration from the diagnostic; rules out maintaining a second operator-facing command index.

## Work

- Update unknown-command rendering to preserve its base diagnostic, derive a unique close match from the registry, and point to `jarvis help`.
- Remove the `expected one of: ...` recognized-command enumeration.
- Add focused regressions in `v2/src/cli.test.ts` for unique, absent, ambiguous, insertion, deletion, substitution, distance-two, and distance-three matches.
- Align the durable operator behavior and v1 parity catalog.

## Acceptance criteria

- [x] Every unknown top-level command preserves `unknown command: <input>` on stderr; a unique suggestion follows it when present, and `jarvis help` guidance is last. Stdout is empty and the exit is 1.
- [x] An unknown name within inclusive Levenshtein distance 2 of exactly one registered top-level command writes `did you mean <name>?`; insertion, deletion, and substitution matches qualify.
- [x] An unknown name at distance 3, or with zero or multiple registered names within distance 2, omits `did you mean` while retaining the base diagnostic and `jarvis help` guidance.
- [x] `v2/src/cli.test.ts` covers unique, absent, ambiguous, insertion, deletion, substitution, distance-two, and distance-three matches; the regressions fail against the pre-fix code and pass after implementation.
- [x] Suggestion candidates come only from the shipped top-level registry; the diagnostic points to canonical `jarvis help` and no longer renders `expected one of: ...` or another command-name list.
- [x] `v2/docs/write-behavior.md` documents canonical help guidance and unique close-match suggestions for unknown top-level commands.
- [x] `v2/docs/v1-behaviors.md` replaces the bare unknown-command divergence with the shipped help-pointer and suggestion semantics.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document unknown-command help guidance and unique close-match suggestions.
- `v2/docs/v1-behaviors.md` — record the updated v2 divergence.
