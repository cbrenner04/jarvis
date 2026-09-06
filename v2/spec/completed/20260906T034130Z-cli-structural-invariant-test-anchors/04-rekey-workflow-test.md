# Re-key v2/src/commands/workflow.test.ts structural anchors

## Problem

Rows `cli-wf-stale-reset-workflows`, `cli-wf-prep-call-count`, and `cli-wf-prep-delegation` in `v2/docs/structural-invariant-test-audit.md` pin stale-reset membership, prepare-call count, and delegation ownership to hardcoded sets, raw substring counts, and one-way absence checks on `workflow.ts`.

## Decision ledger

- `cli-wf-stale-reset-workflows` asserts membership on the exported `STALE_RESET_WORKFLOWS` set (`has("intent")` and roster property), not hardcoded full `Set` equality in the test; rules out duplicating the stale-reset roster beside the import.
- `cli-wf-prep-call-count` resolves the single prepare-call site through loud-failure symbol slicing on the workflow command export, not a raw `readFileSync` regex count alone; rules out count pins that stay green when the call moves behind a re-export wrapper without changing CLI behavior.
- `cli-wf-prep-delegation` pairs absence of stamp and stale-reset calls in the command body with presence in the shared owner via `locateSymbolSlice`; rules out one-way absence regex pins on `workflow.ts` only.

## Task checklist

- [x] Re-key audit rows `cli-wf-stale-reset-workflows`, `cli-wf-prep-call-count`, and `cli-wf-prep-delegation` per the decision ledger.
- [x] Route command and owner body slicing through `shared/structural-test-locator.ts` in the shared workflow-start preparation describe block.

## Acceptance criteria

- [x] `v2/src/commands/workflow.test.ts` test `STALE_RESET_WORKFLOWS membership includes intent` asserts membership on the exported stale-reset set rather than hardcoded full-set equality; it fails against the pre-fix `new Set(["implement", "plan", "intent"])` pin reachable in that test and passes after re-key.
- [x] `v2/src/commands/workflow.test.ts` test `run workflow intent plan and implement preserve prepared start steps through the shared owner` resolves the single prepare-call site via loud-failure symbol slicing rather than a raw file regex count; it fails against the pre-fix `readFileSync` count pin reachable in that test and passes after re-key.
- [x] `v2/src/commands/workflow.test.ts` test `runWorkflowCommand delegates build stamp and stale-reset preparation to the shared owner` pairs command-body absence with owner presence via loud-failure symbol slicing; it fails against the pre-fix one-way absence pins reachable in that test and passes after re-key.
- [x] `v2/src/commands/workflow.test.ts` — `runWorkflowCommand delegates build stamp and stale-reset preparation to the shared owner` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
