# Snapshot-only fix/ready command source for write siblings

## Primary implementation surface

- `v2/src/execution/workflow-runner-resume.ts` (`resolveWriteSiblingCommandSource`)
- `v2/src/execution/workflow-runner-resume-review-dispatch.test.ts`

## Problem

`resolveWriteSiblingCommandSource` spreads `run.queuedInput` and sibling write-row `queuedInput` into `WriteSiblingCommandSource` before snapshot step fields (main ~475–496). After subspec 02, gate fix/ready commands must come from stamped workflow snapshot steps only.

## Decisions

- Remove every `queuedInput` spread from `resolveWriteSiblingCommandSource` return objects; keep `snapshotStep` selection unchanged — rules out reading fix/ready from deprecated persisted write input.
- Do not change snapshot step matching (`ownStep`, review behaviors, durable write sibling lookup) — rules out coupling gate-source deletion to unrelated resume-tail admission.

## Task checklist

- Trim `WriteSiblingCommandSource` if `queuedInput` was part of the exported shape.
- Add or extend a regression in `workflow-runner-resume-review-dispatch.test.ts` that seeds review-row `queuedInput` fix/ready without snapshot commands and asserts `resolveWriteSiblingCommandSource` does not surface them (snapshot-only); fails on main while spreads remain.

## Acceptance criteria

- [ ] `grep -n queuedInput v2/src/execution/workflow-runner-resume.ts` returns zero matches inside `resolveWriteSiblingCommandSource`; fails on main while ~475–496 still spread `queuedInput`.
- [ ] New or updated regression in `workflow-runner-resume-review-dispatch.test.ts` fails on main when `queuedInput` gate commands would win over absent snapshot commands, and passes after snapshot-only `resolveWriteSiblingCommandSource`.
- [ ] `workflow-runner-resume-review-dispatch.test.ts` `review row gate-command reconstruction prefers persisted snapshot step over write sibling` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None beyond subspec 04 catalog/runbook alignment.
