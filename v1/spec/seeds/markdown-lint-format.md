---
name: markdown-lint-format
---

# Markdown linting/formatting for the jarvis repo

## Problem

Specs, seeds, reports, and docs are all Markdown and the corpus is large, but there's no
lint/format gate — line-wrapping, heading style, list markers, table alignment, and trailing
whitespace drift by hand and per-author. The repo already runs `bun run typecheck` / `bun run test`
as gates; Markdown has no equivalent, so prose conventions ("BE TERSE", consistent table/heading
shape) are enforced only by review eyeballs.

## Direction

Add a Markdown lint/format step (e.g. `markdownlint-cli2` and/or `prettier --parser markdown`,
whatever fits Bun) wired into a `bun run` script and the `ready` gate. Options for plan to weigh:

- Lint-only vs. autofix-on-format; pick a config that matches existing house style rather than
  reflowing the whole corpus.
- Scope: which trees are linted (`v1/spec`, `v1/docs`, `reports/`, root docs) and which are
  exempt (frozen `**/completed/**` history, generated CSV-adjacent files).
- A one-time normalize pass vs. lint-new-only, to avoid a giant reflow diff swamping review.

## Out of scope

- Reformatting frozen archived specs under `**/completed/**` (self-naming + history are preserved).

## References

- `package.json` scripts (`typecheck`, `test`, `ready`) — where a `lint:md` step would slot in.
- `v1/docs/spec-guidance.md` — prose conventions a linter should not fight.
