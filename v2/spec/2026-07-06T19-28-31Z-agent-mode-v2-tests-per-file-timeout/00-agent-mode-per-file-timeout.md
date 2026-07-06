# Agent mode runs files serially with a per-file timeout

## Problem

`scripts/run-v2-tests.ts` agent mode runs `bun test --parallel <all agent files>` under one
`AGENT_MODE_TIMEOUT_MS` (300s) SIGKILL. On stall this reports `error: v2 "agent" test run timed
out or was killed` — no file named, whole run wedged. Integration mode's per-file loop already
names the offender via `spawnTimeoutMessage(mode, file)`; agent mode should get the same
isolation.

## Decisions

- Replace agent mode's single `--parallel` invocation with a serial per-file loop, spawning each
  file via its own `spawnSync("bun", ["test", file], ...)` call — rules out one wedged file
  blocking every other agent file's result.
- Reuse `PER_FILE_TIMEOUT_MS`; delete `AGENT_MODE_TIMEOUT_MS` — rules out inventing a second
  agent-specific timeout value the intent didn't ask for.
- On a per-file timeout, print `spawnTimeoutMessage("agent", file)`, SIGKILL that file's process,
  and proceed to the next file — rules out integration mode's fail-fast-on-timeout, since agent
  mode's original `--parallel` semantics already ran every file in one shot; per-file isolation
  should preserve "every file gets a result" rather than aborting the run at the first hang.
- A non-timeout non-zero exit from a file also continues to the next file, for the same
  "every file gets a result" reason; the run's overall exit code is non-zero if any file timed
  out or failed, decided only after all files have run.
- Extract the per-file loop into an exported function taking an injected `spawn` call, per
  [`v2/docs/test-writing.md`](../../docs/test-writing.md)'s DI convention — no real subprocess
  in the test that exercises continue-past-timeout behavior.

## Out of scope

- Fixing the underlying leaked-handle bug in whichever socket test hangs.
- Changing `bun` test semantics or parallelism of other modes (integration mode's fail-fast
  per-file loop is unchanged).
- Raising the timeout as a workaround.

## Acceptance criteria

- [ ] Agent mode's `--parallel` invocation and `AGENT_MODE_TIMEOUT_MS` are removed from
      `scripts/run-v2-tests.ts`; agent mode spawns each file serially via its own `spawnSync`
      call using `PER_FILE_TIMEOUT_MS`.
- [ ] On a per-file timeout, agent mode prints `spawnTimeoutMessage("agent", file)` naming the
      hung file, kills that file's process, and continues running the remaining files instead of
      aborting the run.
- [ ] The overall agent-mode run exits non-zero if any file timed out or exited non-zero, decided
      after all files have run.
- [ ] `scripts/run-v2-tests.test.ts` exercises the continue-past-timeout loop via an injected fake
      `spawn` (no real subprocess), asserting: the timeout message names the hung file, a
      later file in the list still runs, and the aggregate result is non-zero.
- [ ] `bun run test:v2` passes locally and reports per-file results for agent-mode files.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate: add a bullet noting agent-mode `Test (v2)` hangs are
  isolated and named per-file (mirroring integration mode), not a bare global 300s kill.
