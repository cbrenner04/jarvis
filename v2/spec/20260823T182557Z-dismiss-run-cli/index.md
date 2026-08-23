# Dismiss Run CLI

repo: cbrenner04/jarvis

- [ ] [00 - `run dismiss` / `undismiss` subcommands](./00-run-dismiss-undismiss-subcommands.md)
- [ ] [01 - `run list --all` includes dismissed runs](./01-run-list-all-flag.md)

Scope note: CLI surface only — `v2/src/commands/run.ts` plus its usage strings (`v2/src/cli/usage.ts`), command tree (`v2/src/cli/command-tree.ts`), and flag declarations (`v2/src/cli/command-help-flags.ts`). The durable `dismissed_at` column, `dismissRun`/`undismissRun` store operations, and the `dismiss` / `undismiss` / default-excluding `list` RPCs already landed (`dismiss-run-durable-flag`, `dismiss-run-rpc`); no daemon, store, or TUI change lands here — TUI filtering is the `dismiss-run-tui-display` ready intent. The two subspecs are independently testable against a stubbed daemon client: 00 adds the subcommands, 01 adds the listing opt-in.

Premise correction: the intent's `run list --all --json` verification and its "reflected in `--json` output" decision assume a `jarvis run list --json` flag. There is none — `RUN_LIST_PARSE_ARG_OPTIONS` (`v2/src/cli/command-help-flags.ts`) declares only `--since`, `--limit`, `--project`, `--branch`, `--spec`, `--status`, and `runListSubcommand` renders tab-separated rows only. That verification is dropped rather than satisfied by inventing a run-list JSON output mode inside a dismissal spec; `01` instead corrects the two docs that already name the phantom flag (`v2/docs/daemon-host.md` list-row prose, `v2/docs/v1-behaviors.md`). Consequence accepted: after this spec the dismissal timestamp itself stays unreachable from any CLI surface — `--all` exposes only the boolean `dismissed`/`-` marker, never `dismissedAt`. A machine-readable `run list` (and a way to surface the timestamp) is a separate intent.
