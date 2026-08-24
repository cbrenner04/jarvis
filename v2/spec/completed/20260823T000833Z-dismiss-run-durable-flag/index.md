# Dismiss Run Durable Flag

repo: cbrenner04/jarvis

- [x] [00 - Durable run dismissal column and store operations](./00-dismiss-run-durable-flag.md)

Scope note: state store only. This is the foundation the `dismiss-run-rpc`, `dismiss-run-cli`, and `dismiss-run-tui-display` ready intents build on; no daemon request, CLI command, or TUI filtering lands here. The store records and clears the flag and exposes it on reads — it never filters dismissed runs out of `listRuns`, out of `loadRun`, or out of the reconciliation/orphan sweeps, and it never interacts with the daemon's terminal-retention window.
