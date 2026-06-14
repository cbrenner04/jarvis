# Structured logging

Per-run structured log substrate for the daemon and future clients (TUI, workflow
view). Separate from orchestration state in `StateStore`.

## Storage

- SQLite at `~/.jarvis/state/logs.sqlite` by default.
- Own bootstrap and forward-only migrations (`log-repository-migrations.ts`); not
  coupled to `v2.sqlite` state migrations.
- Tests pass a temp path via `openLogRepository(path)` and write nothing under
  `~/.jarvis`.

## Record shape

Each append produces a JSON-friendly object:

| Field | Meaning |
| --- | --- |
| `id` | Unique record ID |
| `runId` | Run key (any string; unknown IDs are valid) |
| `seq` | Per-run sequence, monotonic at append time |
| `ts` | Wall-clock milliseconds |
| `level` | `debug` \| `info` \| `warn` \| `error` |
| `event` | Typed event name (caller-owned string) |
| `data` | Optional JSON payload |

Ordering for replay and live tail uses `seq`, not `ts`. Transcript bodies and
token/cost streams are not stored here.

Daemon lifecycle records use run ID `_daemon` (e.g. `daemon.started`,
`daemon.stopping`).

## API (`log-repository.ts`)

- `append` — persist one record; assigns the next `seq` for the run.
- `listRecords(runId, fromSeq?)` — replay with `seq` strictly greater than
  `fromSeq` (all records when omitted).
- `follow(runId, onRecord, options?)` — live tail after optional cursor;
  `close()` drops one subscriber.

## Live subscribers

- Disconnected IPC tails unsubscribe on socket close.
- Each follower has a bounded buffer (default 64). When backlog exceeds the
  limit, that subscriber is dropped (`slow_consumer`) without blocking `append`
  or other subscribers.

## Boundary from orchestration state

Run checkpoints, attempts, and resume data stay in `~/.jarvis/state/v2.sqlite`.
Rich event history lives only in the log repository so resume reads stay lean.

See also [`daemon.md`](./daemon.md) for `log.tail` IPC framing.
