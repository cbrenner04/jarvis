# Retire `run start` and write-loop row persistence

`jarvis run workflow` replaces `jarvis run start` as the only user-facing write admission path; direct-write IPC rows, durable `queuedInput`, and `ActiveRun` `write-loop` ownership go with the CLI.

- [x] [00-port-keyed-dispatch-coverage-to-run-workflow.md](./00-port-keyed-dispatch-coverage-to-run-workflow.md) — mirror five keyed auto-start cases plus no-preceding-status dispatch on `run workflow` argv before any deletion
- [x] [01-remove-run-start-cli-surface.md](./01-remove-run-start-cli-surface.md) — drop `run start`, `parseWriteCliInput`, and help/usage discovery
- [ ] [02-drop-queued-input-and-write-loop-rows.md](./02-drop-queued-input-and-write-loop-rows.md) — remove daemon direct-`start` admission, `reconstructDirectWriteResume`, and `queuedInput` from durable run state
- [ ] [03-snapshot-only-write-sibling-gate-commands.md](./03-snapshot-only-write-sibling-gate-commands.md) — `resolveWriteSiblingCommandSource` uses snapshot steps only
- [ ] [04-retire-run-start-operator-docs.md](./04-retire-run-start-operator-docs.md) — align walkthrough, config, runbook, write-behavior, and behavior catalog

## Prerequisites

- `retire-run-pause` landed: `run pause` is an unknown subcommand (`v2/src/commands/run.test.ts` `run pause is an unknown subcommand`); `pauseController` / `pauseSignal` are gone (`v2/docs/v1-behaviors.md` behavior-change bullet).
