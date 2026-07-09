# Extract workflow list-snapshot assembly into its own module

`daemon.ts` (1256 lines) contains a self-contained region — `workflowRowSnapshot` and
`workflowStepSnapshot`, plus their supporting types and `stoppedOutcomeForRun` — that
assembles the `workflow` field of the `list` RPC response. Move it to its own module
so `daemon.ts` shrinks and the assembly logic is independently readable.

## Decisions

- New file: `v2/src/daemon/workflow-list-snapshot.ts`, holding `workflowRowSnapshot`,
  `workflowStepSnapshot`, `stoppedOutcomeForRun`, `WorkflowStepListSnapshot`,
  `WorkflowStepListStatus`, and `WorkflowStepTerminalOutcome`.
- `stoppedOutcomeForRun` moves with the region rather than staying in `daemon.ts` — it has
  no callers outside `workflowStepSnapshot`; leaving it behind would force a circular
  import back into `daemon.ts`.
- `daemon.ts` re-exports `WorkflowStepListStatus` and `stoppedOutcomeForRun` so existing
  imports (`daemon-wire.ts`, `daemon-start-list.test.ts`) keep resolving from `./daemon.ts`
  unchanged.
- `LoadedRun`, `WorkflowSnapshot`, and `ReviewDebateProgress` stay defined in `daemon.ts`
  (used well beyond this region) and are imported as types into the new module.
- No behavior change; the `list` RPC response shape is identical.

## Out of scope

- Any behavior change to the `list` RPC response.
- The revise/reconverge region (separate intent).
- Renaming or restructuring the moved types/functions beyond relocating them.

## Task checklist

- [ ] Create `v2/src/daemon/workflow-list-snapshot.ts` with the moved functions/types.
- [ ] Update `daemon.ts` to import `workflowRowSnapshot` from the new module.
- [ ] Add re-exports of `WorkflowStepListStatus` and `stoppedOutcomeForRun` from `daemon.ts`,
      pointing at the new module.
- [ ] Update `v2/docs/v2-architecture.md` domain map to list the new file under the daemon
      host row.

## Documentation updates

- `v2/docs/v2-architecture.md`: add `workflow-list-snapshot.ts` to the daemon host domain
  map row.

## Acceptance criteria

- [ ] `daemon-start-list.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `daemon-wire.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `workflowRowSnapshot` and `workflowStepSnapshot` are defined in
      `v2/src/daemon/workflow-list-snapshot.ts`, not `daemon.ts`.
- [ ] `daemon.ts` re-exports `WorkflowStepListStatus` and `stoppedOutcomeForRun` from the
      new module; `daemon-wire.ts` and `daemon-start-list.test.ts` still import them from
      `./daemon.ts` with unchanged import paths.
- [ ] `v2/docs/v2-architecture.md` domain map lists `workflow-list-snapshot.ts` under the
      daemon host row.
