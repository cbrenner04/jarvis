# Daemon stop refusal checks run liveness

`stopDaemon` refuses on every non-terminal durable row without asking the daemon whether the row is live, and `run kill` refuses the same row as `run_not_active`, so an orphaned non-terminal row can only be cleared by `kill -9` on a daemon that serves every project.

- [x] [00 - Liveness-aware stop refusal with stop-time reconciliation](./00-liveness-aware-stop-refusal.md)
