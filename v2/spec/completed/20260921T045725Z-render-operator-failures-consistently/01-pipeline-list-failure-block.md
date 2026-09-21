# Wire pipeline list to the shared failure formatter

## Problem

`pipeline list` exposes terminal stage `failureDetail` only as raw stage detail; there is no formatted failure block.

## Behavior

Human and JSON `pipeline list` render the formatter from subspec 00 for stages whose `failureDetail` is a valid `OperatorFailureRecord`, keeping existing pipeline identity, ordering, lifecycle, and exit semantics.

## Decisions

- Validity is decided by `operatorFailureRecordFromUnknown` (`shared/operator-failure-record.ts`); rules out treating every failure-shaped object as canonical.
- Human `pipeline list` appends an identity-associated failure section per failing stage (pipeline and stage coordinates outside the block) without changing existing summary-row columns or order; rules out widening stable rows or an ambiguous block when several stages fail.
- Legacy non-record and malformed record-shaped `failureDetail` print no failure block in human output, do not throw, and leave existing row output unchanged; rules out partial blocks or dropped rows.
- `pipeline list --json` retains unchanged stage `failureDetail` and adds `failureText` (block lines joined with `\n`) only beside a valid record; legacy and malformed detail get no `failureText` key; rules out replacing structured evidence, emitting `null`, or forcing scripts to parse prose.

## Task checklist

- [ ] Wire human `pipeline list` to the formatter with per-stage identity.
- [ ] Wire `pipeline list --json` to add `failureText` beside valid records only.

## Acceptance criteria

- [x] A `v2/src/commands/pipeline.test.ts` regression proves `pipeline list --json` preserves the unchanged stage `failureDetail` beside `failureText` for a valid record; it fails against the pre-fix raw-only presentation.
- [x] A `v2/src/commands/pipeline.test.ts` regression proves human `pipeline list` prints the formatter block for a valid record with unambiguous pipeline/stage identity when several stages fail; it fails against the pre-fix omission.
- [x] A `v2/src/commands/pipeline.test.ts` regression proves legacy non-record and malformed record-shaped `failureDetail` produce no human block, no `failureText` key in JSON, unchanged `failureDetail`, and no thrown error; it fails if either shape is rendered as a record.
- [x] `v2/src/commands/pipeline.test.ts` lifecycle/list tests stay green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document run and pipeline formatted failure placement (human list sections; `run wait` JSON and `pipeline list --json` `failureText` presence rules), unchanged structured records in JSON, and preserved lifecycle/exit contracts.
