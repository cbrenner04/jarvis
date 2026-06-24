---
name: markdown-corpus-normalize
---

# One-time normalize pass over the in-scope Markdown corpus

## Problem

Once a Markdown linter/config exists, the existing in-scope corpus does not yet
satisfy it, so the lint step cannot be a green gate.

## Direction

Run a one-time autofix/normalize pass so every in-scope Markdown tree passes
`bun run lint:md` clean. Keep the diff purely mechanical (line-wrapping,
heading/list markers, table alignment, trailing whitespace) — no prose
rewrites. Frozen `**/completed/**` history and generated files stay exempt and
untouched. This is its own change so the large mechanical diff does not mix
with logic changes.

## Out of scope

- Reformatting frozen archived specs under `**/completed/**`.

## Prerequisites

- A `bun run lint:md` script and its house-style config exist.
