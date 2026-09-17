# Resume continues the linked workflow

## Problem

`jarvis run resume` on a linked implement row (`<step>~link-N`, paused or resumable-failed) hands the reconstructed input to `spawnWriteLoop` (`v2/src/daemon/daemon-run-lifecycle-handlers.ts`), which runs the bare write loop for that one row. Nothing sets `publishCompletion` on that path, so the row self-publishes after its own subspec (`v2/src/execution/write-loop.ts` publish gate); the remaining links, `implement~shrink`, and `implement-review` never run, and `rollupWorkflowRunStatus` (`v2/src/persistence/workflow-run-status-rollup.ts`) then reads the invocation `killed` because no shrink row exists. The link → link → shrink → review → publication sequencing lives only in the workflow runner (`runWorkflowStep`, `executeWorkflow` in `v2/src/execution/workflow-runner.ts`), reached only from fresh dispatch. Confirmed empirically by subspec 00's implementer: resuming `implement~link-0` of a 2-entry index published immediately and never created `implement~link-1`.

## Decisions

- Resume of a linked implement row re-enters the workflow runner's linked step dispatch from the resumed row, using the persisted workflow snapshot — not a second orchestration path. Rules out re-implementing link sequencing in the resume handler.
- The resumed link row runs with completion publication off; publication happens once, at the workflow tail, exactly as on fresh dispatch.
- After the resumed row settles, dispatch continues with the next unfinished link (routing by unticked criteria, as fresh dispatch does), then `implement~shrink`, `implement-review`, and tail publication, each as their own durable rows under the same invocation.
- A resumed row that is itself the last link continues to shrink/review/publication; it never self-publishes.
- Rows with no workflow snapshot (`run start`) keep bare write-loop resume.
- Refusals from 00 (unreconstructable linked context) are unchanged.

## Acceptance criteria

- [x] A daemon resume test proves `run resume` on a `failed` `gate_invocation_refused` `implement~link-0` row continues through linked finalization, `implement~shrink`, and `implement-review`, with publication exactly once at the workflow tail; it fails against the pre-fix bare write-loop resume.
- [x] A test proves the resumed invocation's roll-up reads `completed` (not `killed`) and `deriveOperatorIncidents` derives a `run-ad-hoc-terminal` incident with `cause: "completed"` for it; it fails against the pre-fix code.
- [x] `v2/docs/operator-runbook.md` states `gate_invocation_refused` recovery via `run resume` continues through the linked workflow and names the refusal (reason plus recovery) for unreconstructable link rows.
- [x] A test proves resuming the last link row runs `implement~shrink` and `implement-review` and publishes once, and that no resumed link row publishes on its own.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `run resume` on a linked row continues the workflow.
- `v2/docs/workflow-runner.md` — resume re-enters linked dispatch.
- `v2/docs/v1-behaviors.md` — changed resume behavior.
