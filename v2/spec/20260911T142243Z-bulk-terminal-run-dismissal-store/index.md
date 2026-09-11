---
name: bulk-terminal-run-dismissal-store
---

# Dismiss a terminal run selection durably

Adds one persistence-layer bulk dismissal op so higher layers stop reproducing terminal-status, dismissal, and workflow-invocation rules outside the store boundary.

- [x] [00-bulk-terminal-run-dismissal.md](./00-bulk-terminal-run-dismissal.md) — atomic project-scoped terminal-run dismissal in the state store
