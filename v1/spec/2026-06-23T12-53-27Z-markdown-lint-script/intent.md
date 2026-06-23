---
name: markdown-lint-script
---

# Markdown lint/format script with house-style config

## Problem

Markdown (specs, seeds, reports, docs) has no lint/format tool; prose
conventions drift per-author with only review to catch them.

## Direction

Add a Bun-compatible Markdown linter/formatter (markdownlint-cli2 and/or
`prettier --parser markdown`) as a devDependency, a config tuned to existing
house style (do not pick rules that fight `v1/docs/spec-guidance.md`
conventions), and a `bun run lint:md` script. Plan weighs lint-only vs.
autofix-on-format and the scoped trees: lint `v1/spec`, `v1/docs`, `reports/`,
root docs; exempt frozen `**/completed/**` history and generated CSV-adjacent
files.

Scope is config + script only — no corpus reflow, no `ready` wiring here.
Running the script on the current (un-normalized) corpus reporting violations
is acceptable.

## Prerequisites
