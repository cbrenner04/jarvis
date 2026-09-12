# Wire parsers validate structured failure records

## Problem

Run and pipeline wire parsers are envelope-thin by design: `parseListRuns` / `parseWaitCompletion` (`v2/src/daemon/daemon-wire.ts`) cast rows wholesale, and `parsePipelineList` casts snapshots wholesale in two places — `v2/src/daemon/pipeline-daemon-resolution.ts` (multi-socket pipeline resolution) and separately in `v2/src/tui/tui-daemon-client.ts` (the TUI's own RPC client). Once failure evidence is a structured record, a malformed record from a mismatched-build daemon reaches renderers and resume policy typed as valid through any of these. `mergePipelineSnapshots` (`v2/src/daemon/merge-pipeline-snapshots.ts`), which combines snapshots across sockets, only ranks already-parsed `PipelineSnapshot` values and touches no failure field, so it needs no independent validation once its inputs are validated upstream.

## Behavior

The run and pipeline wire parsers validate only the structured failure field, through `operatorFailureRecordFromUnknown`: a malformed record is dropped from the payload while every other field on that row or stage survives. Valid records pass through unchanged. This applies to both `parsePipelineList` implementations.

## Decisions

- Validate only the failure record, not whole rows; rules out reversing the documented envelope-thin IPC policy (`v2/docs/v2-architecture.md`, `## Interface & IPC`) for one field's sake.
- Drop a malformed record and keep the rest of the row rather than rejecting the payload; rules out one bad stage blanking an operator's whole `list` output.
- Reuse `operatorFailureRecordFromUnknown` from `shared/operator-failure-record.ts`; rules out a second, divergent wire-side shape check.
- Validate `tui-daemon-client.ts`'s `parsePipelineList` too, not just `pipeline-daemon-resolution.ts`'s; rules out leaving the TUI's own pipeline-list RPC path — a distinct wholesale cast, not a shared function — reading unvalidated records while the CLI path is covered.
- Leave `mergePipelineSnapshots` untouched; rules out validating the same field twice on the same request.

## Task checklist

- [ ] Validate the run-row and wait-result failure field in `v2/src/daemon/daemon-wire.ts`.
- [ ] Validate stage failure records in `v2/src/daemon/pipeline-daemon-resolution.ts`.
- [ ] Validate stage failure records in `v2/src/tui/tui-daemon-client.ts`'s `parsePipelineList`.
- [ ] Tests for malformed-dropped and valid-preserved on all three payload parsers.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-wire.test.ts` gains a test proving a `list` payload whose row carries a malformed failure record parses with that field absent and all other row fields intact; it fails against the pre-fix wholesale cast.
- [ ] `v2/src/daemon/daemon-wire.test.ts` gains a test proving a valid record on a `wait` payload survives parsing unchanged.
- [ ] `v2/src/daemon/pipeline-daemon-resolution.test.ts` gains a test proving a malformed stage failure record is dropped while sibling stages and stage fields survive; it fails against the pre-fix snapshot cast.
- [ ] `v2/src/tui/tui-daemon-client.test.ts` gains a test proving `pipelineList` drops a malformed stage failure record while its sibling stages and stage fields survive; it fails against the pre-fix wholesale cast.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the narrow failure-record exception to envelope-thin wire parsing on run and pipeline payloads.
- `v2/docs/v1-behaviors.md` — record the changed v2 wire validation.
