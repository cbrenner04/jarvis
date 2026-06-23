---
name: markdown-lint-ready-gate
---

# Wire Markdown lint into the ready gate

## Problem

`bun run typecheck` / `bun run test` gate code via `ready`, but Markdown has no
equivalent enforcement, so prose conventions rot between reviews.

## Direction

Add the Markdown lint step to the `ready` full tier alongside the existing
checks so a Markdown violation fails `ready`. Land this only after the in-scope
corpus passes lint, so the gate is green on `main` at merge.

## Prerequisites
- A `bun run lint:md` script exists.
- The in-scope Markdown corpus passes `bun run lint:md` clean.
