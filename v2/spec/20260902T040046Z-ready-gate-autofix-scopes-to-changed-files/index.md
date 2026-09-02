# Ready-gate autofix scopes to changed files and surfaces diagnostics

Built-in ready-gate repair autofix runs repo-wide `bun run fix` today; pre-existing out-of-diff biome findings can exceed the default diagnostic cap, settle retryable `completion_commit_failed` on otherwise complete runs, and truncate the operative error in `jarvis run log`. This spec scopes built-in autofix to the run's changed paths and raises `--max-diagnostics` on autofix biome subprocesses.

- [x] [00 - Scoped ready-gate repair autofix biome](./00-scoped-ready-gate-repair-autofix.md)
- [x] [01 - Durable docs for scoped ready-gate autofix](./01-durable-docs-ready-gate-autofix-scoping.md)
