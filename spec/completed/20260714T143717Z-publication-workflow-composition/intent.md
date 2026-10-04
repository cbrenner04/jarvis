---
name: publication-workflow-composition
---

# Compose intent and plan publication workflows

Build `intent` and `plan` from one publication definition whose rows select prompt, staging directory, and output contract. Run post-write publication through a landing hook (`intent-stage`, `plan-tree`, or `none`) so the runner does not special-case deferred intent output. Preserve current split, draft, collision, resume, Git, and durable-output behavior while deleting the replaced intent/plan builder and runner surfaces.

## Decisions

- Keep `intent` and `plan` as named publication rows; rules out operator-visible preset replacement.
- Express landing as a post-write hook; rules out another output-domain branch in `workflow-runner.ts`.
- Require material net deletion in the replaced builder and deferred-landing surfaces; rules out a move-only reorganization.
- Keep `workflow-runner.ts` and `write.ts` intact as files; rules out using file splits to satisfy the collapse.

## Documentation updates

- `v2/docs/workflow-runner.md` — publication rows, landing hooks, resume, and ownership boundaries.
- `v2/docs/first-workflow-walkthrough.md` — intent and plan publication behavior.

## Prerequisites

- Intent split and plan draft workflows publish validated staged output with resumable landing semantics.
