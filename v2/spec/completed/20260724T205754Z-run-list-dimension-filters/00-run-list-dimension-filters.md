# Run list dimension filters

Operators need to narrow `jarvis run list` history by project, branch, spec path, or
terminal status without scanning an unfiltered `--since` window.

## Decisions

- Add `--project`, `--branch`, `--spec`, and `--status` to `jarvis run list`; rules out new persistence or indexes — filters use durable `project`, `branch`, `spec_path`, and `status` columns.
- `--project`, `--branch`, and `--spec` match the store value exactly (case-sensitive); rules out prefix or substring match.
- CLI `--spec` maps to RPC `specPath`; rules out filtering on `spec_ref`.
- `--status` accepts one value from `TERMINAL_RUN_STATUSES`; rules out repeat flags, comma lists, or non-terminal statuses.
- Invalid `--status` exits `1` with `invalid_status` before any `list` RPC; rules out silent ignore.
- Missing or empty values for `--project`, `--branch`, `--spec`, or `--status` exit `1` with `invalid_project`, `invalid_branch`, `invalid_spec`, or `invalid_status` respectively before any `list` RPC; rules out silent ignore.
- Set dimension filters compose conjunctively with each other and with `--since` and `--limit`; rules out OR semantics across flags.
- A filtered query is any `list` RPC with at least one of `sinceMs`, `project`, `branch`, `specPath`, or `status`; dimension-only queries use the filtered path (default cap, no `retainListedRuns`); rules out requiring `--since` to enter the filtered path.
- Dimension filters apply to durable store rows before row assembly and reported-status rollup; rules out matching on rolled-up list-row `status`.
- Default `jarvis run list` with no flags is unchanged; rules out requiring a filter flag for the live view.
- Output row format is unchanged; rules out a filter-specific layout.

## Tasks

- Extend `parseListArgv`, `RUN_LIST_USAGE`, and `resolveListRpcRequest` for the four dimension flags; compose with existing `--since` / `--limit` parsing.
- Extend `ListRpcParams` and `listRpcRequestIsFiltered`; update the pure-function test matrix in `run-list-query-limit-cap.test.ts` for dimension-only and mixed filter params.
- In `listHandler`, when filtered: apply each set filter conjunctively on durable rows, then apply explicit or default limit, then assemble rows; skip `retainListedRuns`.
- Add `v2/src/commands/run-list-dimension-filters.test.ts` (daemon direct path, CLI RPC params, retention bypass, log/tail stream-open).
- Document dimension flags in `operator-runbook.md`, `write-behavior.md`, and `v1-behaviors.md`.

## Acceptance criteria

- [x] `--project`, `--branch`, `--spec`, and `--status` each return only matching durable rows; at least two dimension filters and conjunctive composition with `--since` are covered by automated tests.
- [x] A dimension-only filtered query returns terminal runs older than the fifty-newest window when they match (retention bypass); `daemon-terminal-run-retention.test.ts` stays green.
- [x] A run ID returned by a dimension-filtered query beyond the fifty-newest window is accepted by `run log` stream-open and `tui log` tail-open on the same daemon (not `unknown_run`).
- [x] Invalid `--status` exits `1` with `invalid_status` and does not issue a `list` RPC or return rows.
- [x] `run-list-dimension-filters.test.ts` asserts at least two dimension filters and composition; it fails against baseline.
- [x] Tests fail when the `invalid_status` guard is inverted: a non-terminal `--status` value must not return rows.
- [x] Tests fail when dimension-only queries are wrongly treated as unfiltered: inverted `listRpcRequestIsFiltered` (or equivalent guard) must not apply `retainListedRuns` when only dimension RPC fields are set.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — dimension filter examples.
- `v2/docs/write-behavior.md` — `run list` dimension flags.
- `v2/docs/v1-behaviors.md` — record dimension filter flags.
