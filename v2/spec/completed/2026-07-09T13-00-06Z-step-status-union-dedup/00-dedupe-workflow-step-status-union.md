# 00 - Dedupe workflow step-status union

## Problem

`WorkflowStepListStatus` (`v2/src/daemon/daemon.ts:304`) and the inline
`DaemonWorkflowStepSnapshot.status` literal (`v2/src/daemon/daemon-wire.ts:8`)
both spell out `"pending" | "in_progress" | "completed" | "stopped"`
independently. The two can drift silently.

## Decisions

- `daemon.ts` stays the canonical definition site; export
  `WorkflowStepListStatus` and import it into `daemon-wire.ts` — matches the
  existing import direction (`daemon-wire.ts` already imports
  `WaitRunCompletionResult` from `daemon.ts`); rules out inverting that
  direction just for this one type.

## Task checklist

- [ ] Export `WorkflowStepListStatus` from `v2/src/daemon/daemon.ts`.
- [ ] Replace the inline literal on `DaemonWorkflowStepSnapshot.status` in
      `v2/src/daemon/daemon-wire.ts` with an import of
      `WorkflowStepListStatus` from `./daemon.ts`.

## Acceptance criteria

- [x] `DaemonWorkflowStepSnapshot.status` in `v2/src/daemon/daemon-wire.ts`
      is typed via the imported `WorkflowStepListStatus`, not an inline
      literal union.
- [x] `bun run typecheck` passes with no new errors.

## Documentation updates

None — internal type refactor with no behavior, API, or wire-format change.
