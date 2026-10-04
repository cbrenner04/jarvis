---
name: quota-detection-matches-typographic-apostrophe
---

# Quota detection matches the typographic apostrophe the CLIs actually emit

Quota patterns carry `['’]` classes so they match U+2019 output from the agent CLIs, but no test
supplies a U+2019 string — an agent can silently rewrite U+2019 to ASCII and the suite stays green
while quota-exhausted runs settle `ok`.

Pattern sites: `shared/invocation/claude-json.ts`, `shared/invocation/agents.ts` (claude/codex/
cursor quota patterns), `v1/src/agents/quota.ts`.

## Behavior

- Every quota pattern that carries a `['’]` class is exercised against a stderr/envelope string
  using the typographic apostrophe (U+2019), and classifies as quota.
- Coverage lives with each surface's existing quota tests (shared + v1), so the two adapters can't
  drift apart on this.

## Decisions

- Test the typographic variant per pattern, not one representative pattern — the failure mode is a
  blanket rewrite that mangles all of them, but a single-pattern test also passes if one survives.
- Coverage, not a repo-wide non-ASCII lint. Rules out a general lint rule as the fix.

## Prerequisites

## Out of scope

- Deduplicating the divergent copies of the quota patterns.

## Documentation updates

- None.
