# Dismiss Pipeline Durable Flag

repo: cbrenner04/jarvis

- [ ] [00 - Durable pipeline dismissal column and store operations](./00-dismiss-pipeline-durable-flag.md)

Scope note: state store only. This is the foundation the `dismiss-pipeline-rpc`, `dismiss-pipeline-cli`, and `dismiss-pipeline-tui-display` ready intents build on; no daemon request, CLI command, or TUI filtering lands here. The store records and clears the flag and exposes it on reads — it never filters dismissed pipelines out of `listPipelines` or out of the reconciliation/continuation sweeps.
