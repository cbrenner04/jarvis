# Pipeline context loader

## Problem

`mapPipelineRow` parses `pipelines.context` JSON into `PipelineContext` with optional `configPath` and no completeness check. TypeScript types do not survive RPC or SQLite boundaries, so incomplete snapshots can persist and reach dispatch.

## Decision ledger

- Export one `loadPipelineContext` (or equivalent) that validates required admission fields and returns a named `pipeline-context-loader` error — rules out ad hoc `configPath` checks scattered at dispatch sites.
- Required fields match workflow-start preparation: `cwd` (string) and `configPath` (string); rules out inferring machine config from operator-home defaults during load.
- Optional fields (`seed`, `seedPath`, `targetDir`, `projectRegistry`) stay optional; rules out requiring seed mutual exclusivity in the loader (admission callers own that).
- `loadPipeline` / `mapPipelineRow` keep parsing JSON opaquely; validation runs only through the loader at consumption boundaries — rules out migrate-on-read that drops legacy rows at load time.
- Make `configPath` required on the typed `PipelineContext` used for new admissions — rules out `configPath?: string` on the admission write path.

## Task checklist

- Add the loader next to `PipelineContext` in `state-store.ts` (or an adjacent persistence module imported only from persistence/daemon seams).
- Tighten `PipelineContext` typing so `configPath` is required for admissions; fix compile sites that construct incomplete contexts.
- Wire the loader into `persistedContextLoadPermitsContinuation` (or replace that helper) so `context === null` still means absent while incomplete JSON is distinguishable from complete.
- Add `state-store.test.ts` coverage for complete round-trip, each missing required field, and legacy JSON that parses but fails validation.
- Update `v2/docs/state-store.md` for required fields and the named loader error.

## Acceptance criteria

- [x] `state-store.test.ts` — a test asserts `loadPipelineContext` rejects JSON missing `configPath` with a `pipeline-context-loader` error naming the field; it fails against the pre-fix path that casts parsed JSON without validation.
- [x] `state-store.test.ts` — a test asserts a complete admitted snapshot round-trips through `createPipeline` / store reload and passes the loader with equal `cwd` and `configPath`; `Mutation checkpoint:` omitting `configPath` from the reloaded snapshot makes the test fail.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — document required `PipelineContext` fields (`cwd`, `configPath`), optional fields unchanged, and the named `pipeline-context-loader` failure when validation rejects stored JSON.
