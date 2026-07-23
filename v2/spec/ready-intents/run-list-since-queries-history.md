---
name: run-list-since-queries-history
---

# `run list --since` reaches terminal runs past the live window

Terminal runs older than the fifty-newest `LIST_TERMINAL_RUN_LIMIT` window are durable in the store but
unreachable: `jarvis run list` has no flags and `retainListedRuns` drops them. `run log` and `tui log`
need a run ID; without list history the operator must hand-query `~/.jarvis/state/v2.sqlite`.

## Decisions

- Add `--since` to `jarvis run list` (duration like `2d`/`90m` or absolute timestamp); rules out a new `history` top-level command.
- Filtered queries bypass `LIST_TERMINAL_RUN_LIMIT`; rules out applying the fifty-newest cap to an explicit history query.
- Default `jarvis run list` with no flags is unchanged; rules out replacing the live view with a full-store scan.
- Output stays the current row format so returned IDs feed `run log` / `tui log`; rules out a history-specific layout.
- Invalid `--since` exits with a named error; rules out silent ignore or returning the unfiltered default list.
- `--since` results are newest-first; rules out oldest-first or unspecified order.
- Deferred to first consumer: default cap for filtered queries that omit `--limit` — pin when the limit intent lands.

## Acceptance criteria

- [ ] `jarvis run list --since 2d` returns runs created within the last two days, including terminal runs older than the fifty-newest window.
- [ ] `daemon-terminal-run-retention.test.ts` stays green.
- [ ] An invalid `--since` value fails with a named error rather than returning everything.
- [ ] IDs returned by `--since` queries work with `jarvis run log` and `jarvis tui log`.
- [ ] `run-list-since-queries-history.test.ts` drives `--since` past the terminal retention window; it fails against baseline.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — TUI for live, `run list --since` for history, with examples.
- `v2/docs/write-behavior.md` — `run list --since`.
- `v2/docs/v1-behaviors.md` — record filtered `run list` history query.

## Prerequisites
