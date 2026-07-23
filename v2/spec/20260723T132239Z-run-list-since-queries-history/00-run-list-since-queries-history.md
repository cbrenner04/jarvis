# Run list since queries history

Terminal runs older than the fifty-newest `LIST_TERMINAL_RUN_LIMIT` window are durable in
the store but absent from default `jarvis run list`. Operators need run IDs for `run log` and
`tui log` without hand-querying `~/.jarvis/state/v2.sqlite`.

## Decisions

- Add `--since <value>` to `jarvis run list`; rules out a new `history` top-level command.
- Relative durations: `<positive-integer><unit>` with units `d`, `h`, `m`, `s`, subtracted from query time to form the cutoff; rules out free-form prose durations.
- Absolute timestamps: integer Unix milliseconds or ISO 8601, compared against `created_at`; rules out filtering on `updated_at` or other columns.
- Cutoff is inclusive: `created_at >= cutoff`; rules out an exclusive lower bound.
- Parse `--since` at the CLI and pass epoch-ms cutoff on the `list` RPC; rules out daemon-side re-parsing of the raw flag string.
- When `sinceMs` is present, filter durable rows before row assembly and skip `retainListedRuns`; rules out applying `LIST_TERMINAL_RUN_LIMIT` to an explicit history query.
- Default `jarvis run list` with no flags is unchanged; rules out replacing the live view with a full-store scan.
- Filtered results stay in store order (`created_at DESC`, `rowid DESC`); rules out oldest-first or unspecified order.
- Output row format is unchanged; rules out a history-specific layout.
- Invalid `--since` exits `1` with named error `invalid_since` before any `list` RPC; rules out silent ignore or returning the unfiltered default list.
- Deferred to first consumer: default row cap for filtered queries that omit `--limit` — pin when `run-list-query-limit-cap` lands.

## Tasks

- Parse `--since` in `runRunCommand` for `run list`; extend `RUN_USAGE`.
- Extend `list` RPC with optional `sinceMs`; update `daemon-host.md` wire row.
- In `listHandler`, when `sinceMs` is set, keep rows with `created_at >= sinceMs` and bypass `retainListedRuns`.
- Add `v2/src/commands/run-list-since-queries-history.test.ts` (daemon direct path plus CLI path).
- Document operator history query in `operator-runbook.md`, `write-behavior.md`, and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `jarvis run list --since 2d` returns runs created within the last two days, including terminal runs older than the fifty-newest window.
- [ ] `daemon-terminal-run-retention.test.ts` stays green.
- [ ] An invalid `--since` value exits `1` with `invalid_since` and does not issue a `list` RPC or return rows.
- [ ] A run ID returned by `--since` beyond the fifty-newest window is accepted by `run log` stream-open and `tui log` tail-open on the same daemon (not `unknown_run`).
- [ ] `run-list-since-queries-history.test.ts` drives `--since` past the terminal retention window; it fails against baseline.
- [ ] Tests fail when the `invalid_since` guard is inverted: a garbage `--since` value must not return the unfiltered default list.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — TUI for live, `run list --since` for history, with examples.
- `v2/docs/write-behavior.md` — `run list --since`.
- `v2/docs/daemon-host.md` — optional `sinceMs` on `list` RPC; filtered queries bypass terminal retention.
- `v2/docs/v1-behaviors.md` — record filtered `run list` history query.
