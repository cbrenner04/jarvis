# Dismiss Run RPC

repo: cbrenner04/jarvis

- [ ] [00 - Daemon dismiss/undismiss run requests and default-excluding list](./00-dismiss-run-rpc.md)

Scope note: daemon run-request surface (`v2/src/daemon/daemon.ts` handlers, the `DaemonListRunRow` wire type they project, and the `ListRpcParams` field they read), plus the minimal one-line call-site reads needed so existing safety/routing callers keep seeing dismissed runs (`resolveRunOwnerSocket` in `v2/src/commands/run.ts`; `createBulkCleanupDaemonClient`/`createStaleResetDaemonClient` in `v2/src/commands/cleanup.ts`). The durable column and store operations already landed (`dismiss-run-durable-flag`, migration `028-run-dismissed-at`); no CLI subcommand, `--all` flag, or TUI filtering lands here — those are the `dismiss-run-cli` and `dismiss-run-tui-display` ready intents. Display-only `list` callers (`jarvis run list`, `--json`, the TUI) pass no `includeDismissed` and therefore adopt the new default exclusion as-is; the by-id and safety callers above pass `includeDismissed: true` instead, per the subspec's decision ledger.
