---
name: v2-pr-description-summarizes-change
---

# v2 PR description summarizes what landed

`pr-body-refresh.ts` renders a body of `Spec: <path>` plus the attribution footer. A reviewer opening a v2 intent PR sees a path and nothing about the change.

Have each v2 workflow supply body content describing what it produced, rendered above the existing narrative markers and attribution footer:

- intent runs: the seed subject and the intents authored (one line per staged intent file)
- spec/write runs: spec H1 plus the subspec checklist (v1 precedent: `v1/src/modes/plan/pr.ts` header)

Keep the `Spec:` pointer, the `jarvis:narrative` markers, and the footer contract in `refreshPrBody` intact — this replaces the bare header, not the surrounding structure. Refresh is idempotent across retries.

Terse: a few lines, no generated prose essays.

## Prerequisites

- Completion publisher accepts PR metadata supplied by the workflow instead of hardcoding it

## Blocker

- Completion publisher metadata injection is unconfirmed: `v2/src/execution/completion-publisher.ts` still hardcodes PR title and body instead of accepting workflow-supplied metadata.
