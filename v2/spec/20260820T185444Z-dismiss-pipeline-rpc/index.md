# Dismiss Pipeline RPC

repo: cbrenner04/jarvis

- [ ] [00 - Daemon dismiss/undismiss requests and default-excluding pipeline_list](./00-dismiss-pipeline-rpc.md)

Scope note: daemon RPC surface only (`v2/src/daemon/daemon.ts` handlers plus the `v2/src/daemon/pipeline-observation.ts` snapshot projection they return). The durable column and store operations already landed (`dismiss-pipeline-durable-flag`, migration `027-pipeline-dismissed-at`); no CLI command, flag, or TUI filtering lands here — those are the `dismiss-pipeline-cli` and `dismiss-pipeline-tui-display` intents. Existing `pipeline_list` callers pass no parameter and therefore adopt the new default exclusion as-is.
