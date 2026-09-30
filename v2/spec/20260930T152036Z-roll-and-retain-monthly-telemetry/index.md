# Roll telemetry monthly and retain closed months

Monthly UTC roll closes the current `telemetry.jsonl` into retained gzip archives; cleanup must never delete those archives.

- [x] [00-monthly-rolling-telemetry-sink.md](./00-monthly-rolling-telemetry-sink.md)
- [ ] [01-cleanup-preserve-closed-telemetry-archives.md](./01-cleanup-preserve-closed-telemetry-archives.md)
- [ ] [02-document-monthly-telemetry-roll-and-retention.md](./02-document-monthly-telemetry-roll-and-retention.md)
