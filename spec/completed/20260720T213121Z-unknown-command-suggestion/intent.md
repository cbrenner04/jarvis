---
name: unknown-command-suggestion
---

# Suggest one close command for an unknown v2 command

## Outcome

- An unknown top-level command close to exactly one registered name appends `did you mean <name>?`, points at `jarvis help`, and exits non-zero.
- Unknown names with zero or multiple close matches omit a suggestion and still point at `jarvis help`.

## Decisions

- Suggest only when exactly one registered name qualifies as close; rules out choosing the first candidate for an ambiguous typo.
- Define close as a Levenshtein edit distance of at most 2 (insertions, deletions, or substitutions); rules out implementation-dependent suggestion matching.
- Source candidates from the top-level command registry only; rules out duplicated names or unrelated subcommands entering suggestions.
- Keep diagnostics on stderr with empty stdout and a non-zero exit; rules out treating typo assistance as successful help output.
- Replace the inline recognized-command list with the `jarvis help` pointer; rules out maintaining two operator-facing command indexes.

## Acceptance criteria

- [ ] An unknown name within Levenshtein distance 2 of exactly one registered command writes that suggestion and the `jarvis help` pointer to stderr, writes nothing to stdout, and exits non-zero.
- [ ] Unknown names with zero or multiple registered commands within Levenshtein distance 2 omit `did you mean` while retaining the help pointer and non-zero exit.
- [ ] `v2/src/cli.test.ts` regressions for unique, absent, and ambiguous matches fail against the baseline and pass after implementation.
- [ ] Suggestion candidates and the help pointer use the shipped registry/help surface without another command-name list.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document unknown-command help guidance and unique close-match suggestions.
- `v2/docs/v1-behaviors.md` — replace the bare v2 unknown-command divergence with the shipped suggestion semantics.

## Prerequisites

- `jarvis help` exits 0 and the v2 top-level command registry supplies command names, summaries, usages, dispatch, and help output.
