# Re-key workflow-runner-resume-structure.test.ts

## Problem

Row `ex-wrrs-resume-extraction` in `v2/docs/structural-invariant-test-audit.md` pins resume helper extraction to a test-local `EXTRACTED_FROM_WORKFLOW_RUNNER` symbol list with regex scans on production sources, so renames at the extraction boundary red-gate even when paired absence/presence still holds.

## Decision ledger

- Resume helper names resolve from a shared extraction manifest exported beside `workflow-runner-resume.ts`, not a test-local `as const` array; rules out duplicated symbol lists beside the resume module.
- Paired absence/presence scans stay on function-definition patterns in `workflow-runner.ts` and `workflow-runner-resume.ts`; rules out collapsing move checks back to one-way absence.
- Production source reads route through shared loud-failure locators; rules out module-scope `readFileSync` bindings that go stale silently when filenames change.

## Task checklist

- [ ] Re-key audit row `ex-wrrs-resume-extraction` per the decision ledger.
- [ ] Replace the test-local extracted-symbol list with the shared resume extraction manifest.
- [ ] Route production source loading through loud-failure locators where slicing is used.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-resume-structure.test.ts` resume helper move checks iterate a shared extraction manifest rather than a test-local `EXTRACTED_FROM_WORKFLOW_RUNNER` list; it fails against the pre-fix duplicated symbol inventory and passes after re-key.
- [x] `workflow-runner-resume-structure.test.ts` tests `resume helpers are not defined in workflow-runner.ts` and `resume helpers are defined in workflow-runner-resume.ts` stay green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
