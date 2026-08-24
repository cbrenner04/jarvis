# Dismiss Pipeline CLI

repo: cbrenner04/jarvis

- [ ] [00 - `pipeline dismiss` / `undismiss` subcommands](./00-pipeline-dismiss-undismiss-subcommands.md)
- [x] [01 - `pipeline list --all` includes dismissed pipelines](./01-pipeline-list-all-flag.md)

Scope note: CLI surface only — `v2/src/commands/pipeline.ts` plus its usage strings (`v2/src/cli/usage.ts`), command tree (`v2/src/cli/command-tree.ts`), and flag declarations (`v2/src/cli/command-help-flags.ts`). The durable column, store operations, and the `pipeline_dismiss` / `pipeline_undismiss` / default-excluding `pipeline_list` RPCs already landed (`dismiss-pipeline-durable-flag`, `dismiss-pipeline-rpc`); no daemon, store, or TUI change lands here — TUI filtering is the `dismiss-pipeline-tui-display` intent. The two subspecs are independently testable against a stubbed daemon client: 00 adds the subcommands, 01 adds the listing opt-in.
