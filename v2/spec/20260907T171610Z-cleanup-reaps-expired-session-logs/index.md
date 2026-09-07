# Cleanup reaps expired session logs

Terminal-run session logs under `~/.jarvis/sessions/` accumulate indefinitely; cleanup never reaps them. This spec adds a retention slice keyed on durable terminal finish time with a machine-config window, scope guards, and aggregate dry-run reporting.

- [ ] [00 - Cleanup session-log retention config](./00-cleanup-session-log-retention-config.md)
- [ ] [01 - Reap expired session logs](./01-reap-expired-session-logs.md)
- [ ] [02 - Document operator-runbook session-log retention](./02-document-operator-runbook-session-log-retention.md)
- [ ] [03 - Document install-and-config session-log retention](./03-document-install-and-config-session-log-retention.md)
- [ ] [04 - Document v1-behaviors session-log retention](./04-document-v1-behaviors-session-log-retention.md)
