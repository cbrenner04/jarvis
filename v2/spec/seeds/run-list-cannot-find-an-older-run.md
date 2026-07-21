# A run that falls out of the list window becomes unreachable

## Problem

`jarvis run list` accepts **no arguments**:

```ts
// v2/src/commands/run.ts:109
if (subcommand === "list" && argv.length === 1) {
```

No `--since`, `--project`, `--branch`, `--status`, or `--limit`. It renders whatever the daemon
returns, which `retainListedRuns` (`v2/src/daemon/daemon.ts`) caps at all non-terminal runs plus the
`LIST_TERMINAL_RUN_LIMIT = 50` newest terminal ones (plus any terminal run sharing an invocation
with one already kept).

Both `jarvis run log <run-id>` and `jarvis tui log <run-id>` require a run ID, and `list` is the only
way to obtain one. So once a run falls past the 50-newest window, **its ID is unrecoverable through
any jarvis command**, and with it the run's log, outcome, and worktree path.

The data is not gone: the store prunes nothing (no `DELETE FROM runs`, no retention job; the live
database is 2.3 MB of history). It is simply unreachable. The only route is hand-querying
`~/.jarvis/state/v2.sqlite` with `sqlite3` — the shell workaround the north star exists to remove.

Operator framing (2026-07-21): "I suddenly want to see a run from two days ago." Today there is no
answer.

## Prerequisite for TUI retention

`tui-shows-a-live-window-not-fifty-rows` narrows the TUI to a one-hour terminal window. Landing that
first would make history **harder** to reach than today, where 50 terminal rows are at least
visible. This seed must land before it.

## Decisions

- `run list` becomes the query surface, since it is not used for live watching: add `--since`
  (duration like `2d`/`90m`, or an absolute timestamp), `--project`, `--branch`, `--spec`,
  `--status`, and `--limit`. The TUI remains the live surface.
- Filters resolve in the store against existing columns (`project`, `branch`, `spec_path`,
  `created_at`, `status`); rules out new persistence or a separate index for this.
- Filtered queries bypass the `LIST_TERMINAL_RUN_LIMIT` retention window — that cap exists to keep
  the default live view cheap, not to bound history. An explicit query means the operator asked.
- Default behavior with no flags is unchanged, so existing usage and scripts keep working.
- Output stays the current row format, so a returned ID feeds straight into `run log` / `tui log`.
- Bound an unfiltered `--limit`-less query with a sane default so a huge store cannot hang the
  daemon; pin the default in the plan.
- Rules out a new top-level `history` command — this is `run list` doing its job (north star: fold
  into existing commands).

## Acceptance criteria

- [ ] `jarvis run list --since 2d` returns runs created within the last two days, including terminal
      runs older than the 50-newest window.
- [ ] `--project`, `--branch`, `--spec`, and `--status` each filter correctly and compose.
- [ ] `--limit` bounds results; an unbounded query applies a documented default cap.
- [ ] IDs returned by a filtered query work with `jarvis run log` and `jarvis tui log`.
- [ ] `jarvis run list` with no flags behaves exactly as today.
- [ ] An invalid `--since` value fails with a named error rather than returning everything.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — TUI for live, `run list` for history, with examples.
- `v2/docs/write-behavior.md` — `run list` flags.
