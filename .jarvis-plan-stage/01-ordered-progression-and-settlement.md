# Ordered daemon-owned progression and settlement

## Problem

- Stage dispatch alone does not advance a pipeline. Nothing walks the admitted stages in order, gates the next dispatch on the current one's terminal success, or settles the pipeline when a stage fails — and nothing keeps doing so after the admitting client disconnects.

## Decisions

- The daemon runs the pipeline loop in the background off admission (`v2/src/daemon/pipeline-execution.ts`), the same shape as `startWorkflowRun`: the admitting call returns the pipeline ID and the loop keeps running; rules out CLI-side or client-held chaining, which dies with the client.
- Stage N+1 dispatches only after stage N's durable row reads a terminal success status; rules out awaiting the invocation promise alone, which advances on an unrecorded stage and loses ordering across a restart.
- A non-success stage result settles the pipeline there and leaves every later stage `pending` and undispatched; rules out best-effort continuation.
- Pipeline settlement is derived from stage rows, not a new column: success only when every workflow stage reads `succeeded`; rules out a `pipelines.status` column, which would duplicate derivable state and require a migration.
- The loop stops without settling at an approval stage. Deferred to first consumer: approval-stage transition semantics — pin when the approval slice consumes approval stages.

## Task checklist

- Add `v2/src/daemon/pipeline-execution.ts`: the ordered loop over `loadPipeline` stages, the success gate, and failure settlement.
- Wire the loop to run in the daemon background after admission returns the pipeline ID.
- Add `v2/src/daemon/pipeline-execution.test.ts`.
- Update `v2/docs/daemon-host.md` and `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` disconnects the admitting client before stage one settles and still observes later stages dispatch and the pipeline settle; it fails against the pre-change code.
- [ ] A workflow-only pipeline executes stages in definition order, and a controlled stage N+1 receives no dispatch until stage N records terminal success.
- [ ] A failed stage records its failure detail, settles the pipeline non-successfully, and leaves every later stage `pending` with no dispatch.
- [ ] The pipeline reads successful only after every workflow stage records success.
- [ ] A pipeline whose next stage is an approval stage stops there: no dispatch, no settlement, later stages untouched.
- [ ] Inverting the progression guard (dispatching before terminal success) and the failure-stop guard each turn the corresponding test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md` documents daemon ownership after client disconnect, ordered progression, failure settlement, and the approval-stage stop; `v2/docs/state-store.md` documents derived pipeline success/failure from stage rows.

## Documentation updates

- `v2/docs/daemon-host.md` — daemon-owned pipeline loop, ordered progression, failure settlement, approval-stage stop.
- `v2/docs/state-store.md` — derived pipeline settlement from stage rows.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only behavior.
