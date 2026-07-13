# Quota patterns can lose their typographic apostrophe with the suite still green

`shared/invocation/claude-json.ts` matches claude's quota envelopes with patterns like
`/\byou['’]ve hit your (?:session|weekly|opus) limit\b/i` — the character class carries **both**
the ASCII apostrophe and U+2019, because the claude CLI emits the typographic one.

An agent editing that file rewrote every `['’]` to `['']` (U+2019 replaced by a second ASCII
quote). The class still compiles, the whole suite stays green, and **quota detection silently
stops matching claude's actual output.** A quota-exhausted claude would settle `ok`.

## Problem

Observed 2026-07-13 in the `shared-invocation-claude-stream-json` run: the agent's diff to
`claude-json.ts` mangled all three patterns while porting the parser. `bun run ready` was green.
The operator caught it by reading the diff, which is not a gate.

Nothing tests the typographic variant: `shared/invocation/claude-json.test.ts` contains no U+2019
at all, so every quota assertion exercises only the ASCII half of the class. The pattern's whole
reason for existing is untested.

## Decisions

- **Each quota pattern is tested against the typographic apostrophe it exists to match**, not
  only the ASCII one. Rules out relying on diff review to protect a non-ASCII literal.
- Same coverage for the v1 adapter's patterns (`v1/src/agents/claude-json.ts`) if they carry the
  same classes — the two adapters diverging is its own hazard
  (`shared-invocation-loses-cost-and-claude-output`).

## Prerequisites

- None.

## Out of scope

- A general lint against non-ASCII rewrites; the fix here is coverage of the behavior that
  matters.

## Documentation updates

- None.
