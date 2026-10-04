---
name: implement-pr-body-carries-authored-narrative
description: v2 implement PR bodies carry an agent-authored review-altitude narrative in the marker block, produced by the shrink pass.
---

# v2 implement PR bodies carry an agent-authored narrative

## Problem

`pr-body-refresh.ts` preserves any narrative found between
`<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->`, but nothing in v2
writes those markers, so the preserve path is dead. Every v2 implement PR ships with
only the templated `Spec:` header — no summary, reproduction, or rationale — despite
config declaring `prNarrative: "agent"`. Reviewers get the spec path and nothing else,
pushing the whole change onto diff-reading.

## Behavior

The v2 publication path emits an authored narrative into the marker block for implement
runs, produced inside the existing post-completion shrink pass (no new publication-time
agent call). The narrative describes the change at review altitude — what changed, why,
how to verify — not a restatement of the `Spec:` header. Markers are always emitted so
`pr-body-refresh.ts`'s extract/preserve logic round-trips on any subsequent re-publish.

## Notes

Distinct from `acceptance-criteria-must-be-satisfiable-by-the-agent`: that concerns the
implement agent not owning publication. This is the harness's own publication step doing
the `prNarrative` job it already claims. Same publication seam as
`completion-commit-message-is-a-fixed-template` — a same-seam sibling; plan and run
serially against the merged result, not fanned out in parallel.

## Documentation updates

- `v2/docs/workflow-runner.md` — where the PR narrative is authored and the marker contract.
- `v2/docs/operator-runbook.md` § Gate trust / publication — the PR body now carries a narrative.
- `v2/docs/v1-behaviors.md` — record the changed v2 publication behavior.

## Prerequisites

- The post-completion shrink pass runs once after implement completion.
- The publication path refreshes the PR body via a spec header plus attribution footer, preserving any narrative marker block.
