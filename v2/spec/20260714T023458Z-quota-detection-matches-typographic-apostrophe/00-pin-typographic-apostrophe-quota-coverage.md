# 00 - Pin U+2019 quota patterns in shared and v1 tests

Quota patterns carry `['’]` classes so they match the typographic apostrophe (U+2019) the agent CLIs
emit, but no test supplies a U+2019 string. An agent can rewrite U+2019 to ASCII across the pattern
tables and the suite stays green while quota-exhausted runs settle `ok`.

Patterns carrying a `['’]` class:

- `shared/invocation/claude-json.ts` — claude envelope: session/weekly/opus limit, monthly spend
  limit, org's monthly usage limit (two apostrophes).
- `shared/invocation/agents.ts` — claude (same 3), codex (`you've hit/reached your usage limit`),
  cursor (`you've hit your usage limit`, `you've hit your free requests limit`).
- `v1/src/agents/quota.ts` — the same six claude/codex/cursor patterns.

## Decisions

- One U+2019 case per pattern, not one representative — a blanket ASCII rewrite mangles all of them,
  and a single-pattern test still passes if one survives. Rules out a single smoke test.
- Coverage only; no repo-wide non-ASCII lint rule.
- Tests assert via each surface's existing public classification entry point (shared envelope/agent
  classification, v1 quota classification), not by importing the regex arrays — rules out asserting
  on the pattern tables themselves, which would not prove classification.
- Source literals in `index`/`org['’]s` cases use U+2019 for both apostrophes.
- Divergent copies of the pattern tables stay divergent (out of scope).

## Acceptance criteria

- [ ] A claude stderr/envelope string using U+2019 for each of the three claude quota phrases
      (session/weekly/opus limit, monthly spend limit, org's monthly usage limit) classifies as quota
      in `shared/invocation/claude-json.test.ts` and `shared/invocation/agents.test.ts`.
- [ ] A codex stderr string using U+2019 in `you’ve hit your usage limit` (and the `reached`
      alternation) classifies as quota in `shared/invocation/agents.test.ts`.
- [ ] A cursor stderr string using U+2019 in `you’ve hit your usage limit` and `you’ve hit your free
      requests limit` classifies as quota in `shared/invocation/agents.test.ts`.
- [ ] The same six claude/codex/cursor U+2019 phrases classify as quota in `v1/test/quota.test.ts`.
- [ ] Rewriting any one `['’]` class in `shared/invocation/claude-json.ts`,
      `shared/invocation/agents.ts`, or `v1/src/agents/quota.ts` to `'` alone fails at least one test.
- [ ] `bun run typecheck`, `bun run test:v1`, and `bun run test:v2` pass.

## Documentation updates

- None (test-only; no behavior change).
