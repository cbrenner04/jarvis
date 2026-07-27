---
name: pipeline-daemon-ordered-execution
---

# Daemon-owned ordered pipeline execution

Slice 2b of [per-project pipelines](../v2/spec/per-project-pipelines-brief.md).

## Prerequisites

- A validated pipeline can be admitted as durable pipeline and ordered stage records
- Named workflow presets can be built into executable workflow steps
- The daemon can run a workflow in the background after returning its durable run ID

## Problem

Durable rows alone do not advance a pipeline. Stage progression must remain daemon-owned,
ordered, and failure-stopping after the admitting client disconnects.

## Decisions

- The daemon owns the pipeline loop from admission through settlement; rules out CLI-side or client-side workflow chaining.
- A workflow stage dispatches one real workflow invocation and records its invocation ID before advancing; rules out synthetic or inferred invocation linkage.
- Each workflow stage's review posture selects its executable preset or builder behavior; rules out silently substituting an unrelated project review default.
- The next stage dispatches only after the current stage records terminal success; rules out parallel or optimistic stage dispatch.
- A non-success workflow result records the stage failure, settles the pipeline there, and leaves later stages undispatched; rules out best-effort continuation.
- A completed stage records the workflow's durable artifact reference; rules out copying artifact content into SQLite because the state store carries orchestration pointers.
- Deferred to first consumer: approval-stage transition semantics — pin when the approval slice consumes approval stages.

## Acceptance criteria

- [ ] A workflow-only pipeline executes stages in definition order, and a controlled stage N+1 receives no dispatch before stage N records terminal success.
- [ ] Every dispatched stage records start/end timestamps, terminal status, and its produced artifact reference.
- [ ] Each stage workflow invocation ID resolves to the workflow run row created by that dispatch.
- [ ] A failed stage records its failure detail, settles the pipeline non-successfully, and prevents every later dispatch; inverting the progression guard turns the test RED.
- [ ] The pipeline records success only after every workflow stage succeeds.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` disconnects the admitting client before stage one settles, proves later daemon-owned progression, fails before this change, and passes after it.

## Documentation updates

- `v2/docs/daemon-host.md` — daemon ownership, ordered progression, invocation linkage, artifact recording, and failure settlement.
- `v2/docs/state-store.md` — lifecycle updates and workflow invocation linkage.
