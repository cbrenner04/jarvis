---
name: daemon-handoff-failure-restores-incumbent
---

# Restore the incumbent after a failed daemon handoff

A daemon handoff remains reversible until the successor is ready: startup failure returns stable-address ownership and admission to the still-running incumbent without disturbing its admitted work.

- [x] [00-rollback-failed-daemon-handoff-incumbent.md](./00-rollback-failed-daemon-handoff-incumbent.md)
- [x] [01-rollback-failed-daemon-handoff-successor.md](./01-rollback-failed-daemon-handoff-successor.md)
