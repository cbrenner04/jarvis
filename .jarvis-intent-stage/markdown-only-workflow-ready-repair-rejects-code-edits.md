---
name: markdown-only-workflow-ready-repair-rejects-code-edits
---

# Markdown-only workflows reject ready-gate repair edits outside Markdown artifacts

## Problem

Intent and plan workflows produce only Markdown. A red ready gate still invoked repair that committed
v1 tests, scripts, and harness sidecars on PR #2243.

## Decisions

- Workflows whose publication artifact contract is Markdown-only (intent, plan) treat every ready-gate
  repair staged path as forbidden unless it is under the workflow's Markdown output roots and ends in
  `.md`. Rules out agent judgment about "harmless" code fixes.
- Rejection is per surface class: at least one test each for a staged source file, a staged script,
  and a staged test file. Rules out one generic "non-md" case that misses a class.

## Acceptance criteria

- [ ] On an intent workflow, a ready-gate repair that stages a source-path edit fails and is not
      committed; a dedicated test fails against pre-fix behavior.
- [ ] The same fence rejects a staged script-path edit; a dedicated test fails against pre-fix
      behavior.
- [ ] The same fence rejects a staged test-path edit; a dedicated test fails against pre-fix
      behavior.
- [ ] A repair that stages only allowed Markdown under the workflow output roots still proceeds
      through the existing repair loop.

## Documentation updates

- `v2/docs/write-behavior.md` — Markdown-only workflow repair prohibition.

## Prerequisites

- Ready-gate repair completion validates staged paths before commit (run diff plus spec tree fence).
