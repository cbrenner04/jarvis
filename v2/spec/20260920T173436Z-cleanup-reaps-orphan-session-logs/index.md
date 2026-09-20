# Cleanup reaps orphan session logs by mtime, streamed

The session-log reaper only reaps logs whose basename parses to a terminal run row with `finishedAt`, so logs whose run row is gone (purged store, fixtures) live forever; discovery also materializes the whole sessions directory with `readdirSync`.

- [x] [00-reap-orphan-session-logs-by-mtime.md](./00-reap-orphan-session-logs-by-mtime.md)
