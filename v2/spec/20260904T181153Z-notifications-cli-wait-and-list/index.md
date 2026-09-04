# `jarvis notifications wait` and `list` are the supported operator wake primitive

- [x] [00 - Notifications CLI wait and list](./00-notifications-cli-wait-and-list.md)
- [x] [01 - Document notifications wake primitive](./01-document-operator-notifications-wake-primitive.md)

Land **00 → 01**: CLI subcommands delegate to daemon `notification_wait` / `notification_list` RPCs; operator runbook names `jarvis notifications wait` as the supported wake primitive.
