---
name: improve-template-pr-narrative-quality
---

# `template` prNarrative conveys what changed and why, not just titles

## Problem

`generateTemplateNarrative` (`v1/src/pr-shared.ts`) emits only subspec titles +
commit subjects — it states *what work items* exist but not *what changed or
why*, so it carries little review value. The deterministic template should pull
a real summary / rationale / risk signal from the diff and spec, while staying
deterministic and token-free (no agent call).

## Direction

Enrich the template narrative so a reviewer sees substance:
- a change summary derived from the diff (e.g. files/areas touched, scale of
  change), not a bare title list
- why/risk cues sourced from the spec text and/or diff, deterministically
- keep it cheap and deterministic — no model invocation

Update `v1/docs/worktrees-and-commits.md` template-mode description and
`v2/docs/v1-behaviors.md` to match the new template output.

## Out of scope

- Changing the default `prNarrative` mode (separate behavior).
- The `agent` narrative path and its sentinel extraction.
- Removing `template` mode.

## Prerequisites

- template prNarrative is generated deterministically from spec index subspec titles and branch commit subjects
