# Shared operator failure record

Module boundary: shared (`shared/operator-failure-record.ts`).

Run and pipeline persistence need one cross-library evidence contract before either durable seam can consume it. This subspec defines that contract and its non-throwing stored-JSON parser only; run storage and pipeline-stage wiring are deferred to [01](./01-run-operator-failure-record-persistence.md) and [02](./02-pipeline-stage-operator-failure-record-contract.md).

## Decision ledger

- Export `OperatorFailureRecord` from `shared/operator-failure-record.ts`; rules out a v2-local type or separate run and pipeline contracts.
- `expectation` and `observation` are required strings, `nearMiss` is an optional string, and `retryable` is a required boolean; rules out verdict-only blobs without comparable facts.
- `referencedPaths` is a required zero-or-more array of `{ path: string, origin: "harness-internal" | "operator-repository" }`; rules out omitted path ownership or renderers inferring it from text.
- `parseOperatorFailureRecord(json: string | null)` returns exactly `{ kind: "absent" }`, `{ kind: "invalid" }`, or `{ kind: "valid", record: OperatorFailureRecord }`; rules out callers catching syntax errors or accepting partial records.
- The parser accepts no non-object record, non-string field, non-boolean retryability, non-array path list, or path with a non-string path or unrecognized origin; rules out coercing malformed durable evidence.

## Task checklist

- Add `shared/operator-failure-record.ts` exporting `OperatorFailurePathOrigin`, `OperatorFailureReferencedPath`, `OperatorFailureRecord`, `OperatorFailureRecordParseResult`, and `parseOperatorFailureRecord`.
- Add `shared/operator-failure-record.test.ts` covering valid records, absent near miss, zero paths, both origins, malformed JSON syntax, and invalid record/path shapes.
- Document the shared record's field and path-origin contract in `v2/docs/state-store.md`.

## Acceptance criteria

- [x] `shared/operator-failure-record.test.ts` test `parseOperatorFailureRecord accepts a record with expectation, observation, near miss, retryability, and both path origins` serializes a representative record and asserts `{ kind: "valid", record }`; it fails against the pre-fix module absence reachable on main.
- [x] `shared/operator-failure-record.test.ts` test `parseOperatorFailureRecord accepts omitted nearMiss and an empty referencedPaths list` proves those precise optionality and cardinality rules; it fails against the pre-fix module absence reachable on main.
- [x] `shared/operator-failure-record.test.ts` test `parseOperatorFailureRecord rejects malformed JSON and invalid record shapes without throwing` asserts `{ kind: "invalid" }` for malformed syntax, a non-object, missing or wrongly typed required fields, a non-array path list, and invalid path/origin values; it fails against the pre-fix module absence reachable on main.
- [x] `v2/docs/state-store.md` documents the shared record fields and `harness-internal` / `operator-repository` path-origin contract.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/state-store.md` — shared record fields and path-origin contract.
