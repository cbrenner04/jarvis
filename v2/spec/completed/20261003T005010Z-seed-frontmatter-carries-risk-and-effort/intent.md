---
name: seed-frontmatter-carries-risk-and-effort
---

# Seeds carry validated `risk` and `effort` ratings in frontmatter

## Problem

Seed frontmatter carries only `name`; nothing describes the consequences of getting a change wrong (risk) or its expected size (effort), so pipeline selection cannot read either.

## Decisions

- Seeds carry separate optional `risk` and `effort` frontmatter ratings; neither substitutes for the other.
- Plan must decide the rating scale (levels, one-line definitions, an example per level); the scale is one closed vocabulary shared by seed parsing, project minimums, and CLI flags.
- Parsing validates a supplied rating against the scale and rejects malformed values by name; a missing rating is not a parse error (admission owns missing-rating policy).
- Existing seeds without ratings keep parsing.

## Prerequisites

## Acceptance criteria

- [x] `seed-metadata.test.ts`: both ratings, one rating, none, and an unknown level each produce the expected typed result or named rejection; every file under `v2/spec/seeds/` still parses; fails against current code (no rating fields).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — rating definitions, frontmatter syntax, examples.

## Primary implementation surface

- the seed frontmatter parser (`shared/` seed metadata, wherever `name:` is parsed today)
