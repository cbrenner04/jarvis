---
name: v2-pr-title-from-workflow
---

# v2 PR title reflects the work, not a fixed string

Every v2 PR is titled `jarvis: complete run` — `completion-publisher.ts` hardcodes it in `findOrCreatePr`. Intent runs, write runs, and plan runs are indistinguishable in the PR list.

Make the PR title a value the workflow supplies to the publisher, and have each v2 workflow supply one derived from its own subject:

- intent runs: the seed/intent subject (e.g. `intent: <name>`)
- spec/write runs: the spec `index.md` H1 (v1 does this via `getIndexTitle`)
- fallback to today's string only when no subject is resolvable

v1 precedent: `v1/src/pr.ts` (`ensureDraftPr` takes `title`), `v1/src/modes/plan/pr.ts`, `v1/src/modes/patch/iteration.ts`.

Existing PRs are not retitled; this applies at creation.

## Prerequisites
