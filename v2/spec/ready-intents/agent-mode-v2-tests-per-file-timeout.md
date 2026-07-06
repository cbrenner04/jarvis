---
name: agent-mode-v2-tests-per-file-timeout
---

# Agent-mode v2 tests: per-file timeout that names and isolates a hung file

`scripts/run-v2-tests.ts` agent mode runs one `bun test --parallel <all agent files>` under a
single global 300s SIGKILL. On stall this reports `error: v2 "agent" test run timed out or was
killed` — no file named, whole run wedged. Integration mode already runs files serially with a
per-file timeout and names the offender via `spawnTimeoutMessage(mode, file)`.

## Decisions

- Agent mode runs each file in its own killable `bun test <file>` process, serially, same as
  integration mode; drop the single `--parallel` invocation and the global `AGENT_MODE_TIMEOUT_MS`
  kill.
- On a per-file timeout, print `spawnTimeoutMessage(mode, file)` naming the hung file; SIGKILL that
  file's process; continue running the remaining files.
- Reuse `PER_FILE_TIMEOUT_MS` (integration mode's constant) instead of introducing a new timeout
  value.

## Out of scope

- Fixing the underlying leaked-handle bug in whichever socket test hangs.
- Changing `bun` test semantics or parallelism of other modes.
- Raising the timeout as a workaround.

## Tests / verification

- `scripts/run-v2-tests.ts` agent mode, given a file that hangs past the per-file timeout, exits
  non-zero with a message naming that file (mirror the existing integration-mode timeout test).
- `bun run test:v2` passes locally and reports per-file results.

## Documentation updates

- `v1/docs/operator-runbook.md` (§ The gate): update the `Test (v2)` hang bullet — agent mode now
  names and isolates a hung file per-file instead of a bare global kill.

## Prerequisites
