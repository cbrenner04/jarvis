# 01 - Review run row identifies what it reviewed

## Problem

The durable review run row is created with `specRef: ""` and `specPath: ""`
(`v2/src/execution/workflow-runner.ts:1765-1772`), so the row an operator lists
or tails does not say what was reviewed.

## Decisions

- Mirror the write-loop run row (`write-loop.ts:484`): `specRef` = the step's `deferredIntentOutput.baseRef`; `specPath` = the staged intent tree under review (`deferredIntentOutput.stagingDir`) — not the verdict path, which is the review's output, not its subject.
- Only the durable (reviewed-intent) review run row changes; non-durable review steps still create no row.

## Acceptance criteria

- [ ] A reviewed-intent review step's run row carries the base ref it reviewed against in `specRef` and the staged intent tree path in `specPath`.
- [ ] `v2/src/execution/workflow-runner.test.ts` asserts both fields on the loaded review run row.

## Documentation updates

- `v2/docs/workflow-runner.md` — Review dispatch: what the review run row records as its spec identity.
