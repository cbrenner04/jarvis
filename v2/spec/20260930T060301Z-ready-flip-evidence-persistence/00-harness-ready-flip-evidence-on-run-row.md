# Harness ready-flip evidence on run rows

Republication must distinguish a harness-flipped open PR from an operator-flipped one, but no durable run-row field records that this lane's completion path successfully ran `gh pr ready`. This subspec adds the column, write and lineage-read ops, and store tests; it does not wire `ready-finalize` / `terminal-publication` or change publication refusal (see `v2/spec/seeds/republication-refuses-pr-the-lane-flipped-ready.md`).

## Decisions

- Persist one nullable JSON column on `runs` (`harness_ready_flip_evidence`) holding `{ prNumber, branch, baseRef, flippedAt }` — rules out a side table and rules out nullable scalar columns without a grouped contract.
- `flippedAt` is Unix epoch ms stamped by the store at `recordHarnessReadyFlipEvidence` write time — rules out caller-supplied flip times that would break audit ordering.
- `recordHarnessReadyFlipEvidence` is the only writer; it replaces any prior value on that row — rules out append-only per-row history (cross-row lineage is the history).
- Failed ready flips write nothing: no implicit write from `commitTerminalRunSettlement`, `setPrEvidence`, or terminal settlement evidence — rules out coupling harness flip evidence to PR settlement columns.
- Lineage scope for reads is every `runs` row sharing `(project, branch, spec_ref)`, ordered `created_at DESC, rowid DESC` — rules out `findReviewMutationLineageRows` without `spec_ref` filter when the same branch reused another spec.
- `findNewestHarnessReadyFlipEvidenceInLineage` scans that order and returns the first row whose parsed evidence matches the query triple `(branch, baseRef, prNumber)` exactly — rules out returning the oldest match and rules out partial triple matches.
- Rows with absent, null, or unparseable `harness_ready_flip_evidence` are skipped during the scan without throwing — rules out failing the whole lookup on one corrupt legacy row.
- Fresh baseline `CREATE` and `addColumnIfMissing` on open carry the column — rules out a numbered data migration for backfill (legacy rows simply have no evidence).
- Deferred to first consumer: whether republication passes `spec_ref` or resolves lane identity via `spec_path` — pin when the republication intent wires the lookup; this subspec keys lineage on durable `spec_ref` as stored on `createRun`.

## Tasks

- [ ] Add `HarnessReadyFlipEvidence` type, column repair, `mapRunRow` projection (`harnessReadyFlipEvidence` plus corrupt flag if the repo's JSON-column pattern requires it), and `StateStore` methods `recordHarnessReadyFlipEvidence` / `findNewestHarnessReadyFlipEvidenceInLineage`.
- [ ] Add `v2/src/persistence/state-store.test.ts` coverage for success write, no evidence without an explicit record (including after terminal settlement without the record op), newest hit across an older lineage row, and misses when `branch`, `baseRef`, `prNumber`, or lineage keys (`project`, `spec_ref`, or branch lane) differ.
- [ ] Document the column and lookup contract in `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `state-store.test.ts` fails against the pre-fix schema and pins write-after-success, no write when `gh pr ready` does not succeed (terminal settlement without `recordHarnessReadyFlipEvidence` leaves evidence absent), lineage hit across an older row on the same lane, and miss when branch, base, number, or lineage differ.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `harness_ready_flip_evidence` fields, `recordHarnessReadyFlipEvidence`, and `findNewestHarnessReadyFlipEvidenceInLineage` lineage lookup contract.
