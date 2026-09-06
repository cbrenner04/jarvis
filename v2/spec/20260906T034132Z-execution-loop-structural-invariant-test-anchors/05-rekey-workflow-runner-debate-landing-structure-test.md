# Re-key workflow-runner-debate-landing-structure.test.ts

## Problem

Row `ex-wrdls-debate-absence` in `v2/docs/structural-invariant-test-audit.md` pins debate-landing extraction to a one-way absence scan of `EXTRACTED_FROM_WORKFLOW_RUNNER` symbols in `workflow-runner.ts`, so deleting helpers outright passes vacuously while the landing module contract is broken.

## Decision ledger

- Debate-landing extraction asserts paired absence in `workflow-runner.ts` and presence in `workflow-runner-debate-landing.ts` for each tracked helper name; rules out one-way absence checks that pass on outright deletion.
- Tracked helper names resolve from a shared extraction manifest exported beside the landing module (or the landing module itself), not a test-local `as const` list; rules out duplicated symbol inventories that drift from the extraction boundary.
- Production source reads route through shared loud-failure locators; rules out silent empty reads when a module path moves.

## Task checklist

- [ ] Re-key audit row `ex-wrdls-debate-absence` per the decision ledger.
- [ ] Add paired presence assertions in `workflow-runner-debate-landing.ts` mirroring the absence scan.
- [ ] Replace the test-local symbol list with the shared extraction manifest.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-debate-landing-structure.test.ts` test `review-debate landing helpers are not defined in workflow-runner.ts` pairs absence in `workflow-runner.ts` with presence in `workflow-runner-debate-landing.ts` for each manifest-listed helper; it fails against the pre-fix one-way absence scan and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
