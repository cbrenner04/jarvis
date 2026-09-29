# Configure hot and cold session-log retention

- [ ] [00-retention-sessions-config.md](./00-retention-sessions-config.md) — replace `cleanup.sessionLogRetentionDays` with a global `retention.sessions` `{ hotDays, coldDays }` block; the existing reaper reads `coldDays`.
