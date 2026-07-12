---
name: shared-linked-subspec-routing
---

# Share linked-subspec routing outside the workflow runner

Move linked-index selection, advancement, terminal detection, and error classification to `shared/`. Make implement builders and the runner consume that contract so `workflow-runner.ts` only coordinates steps. Preserve direct-subspec, empty-index, completed-index, malformed-link, and multi-subspec behavior.

## Decisions

- Place linked-subspec routing in `shared/`; rules out runner-owned index state transitions.
- Expose one routing contract to builders and execution; rules out duplicated preflight and runtime interpretations.
- Keep `workflow-runner.ts` intact as a file; rules out hiding routing complexity behind a runner file split.

## Documentation updates

- `v2/docs/workflow-runner.md` — shared routing ownership and thin-runner boundary.

## Prerequisites

- Linked-index implement runs have pinned selection, advancement, completion, and failure behavior.
