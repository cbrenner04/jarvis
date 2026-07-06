---
name: agent-mode-v2-tests-per-file-timeout
---

# Agent-mode v2 tests: per-file timeout that names (and isolates) a hung file

`scripts/run-v2-tests.ts` agent mode runs a **single** `bun test --parallel <all agent files>`
under one **global** 300s `spawnSync` SIGKILL (`AGENT_MODE_TIMEOUT_MS`). Integration mode, by
contrast, runs each file **serially with a per-file timeout** and, on timeout, prints
`spawnTimeoutMessage(mode, file)` — naming the offending file.

The recurring `Test (v2)` CI stall is an intermittent worker-process-won't-exit hang in one of the
real-socket agent test files (a leaked/lingering socket-or-server handle keeps a `bun --parallel`
worker alive after its tests pass; no per-test hook times out — the run just goes silent for 5 min
until the global SIGKILL). Because agent mode has only the global timeout, the failure is a bare
`error: v2 "agent" test run timed out or was killed` that **names no file**, and one hung worker
wedges the whole run. Diagnosis burned three fix attempts partly because CI never says which file.

## Decisions

- Agent mode gets a **per-file timeout** and names the hung file on timeout, the same as
  integration mode already does (`spawnTimeoutMessage(mode, file)`), instead of a single global
  timeout that names nothing.
- Prefer running the agent files **each in its own killable `bun test <file>` process** (as
  integration mode does). This both names the staller and isolates it: a leaked-handle hang in one
  file is SIGKILLed at the per-file timeout and reported by name, while the other files still run
  and pass — converting a total wedge into a single named failure. Losing `--parallel` is
  acceptable (normal per-file runtime is sub-second; the whole agent set is a few seconds serial).
- Keep a per-file timeout comfortably above legitimate runtime but well under the old 300s global
  (e.g. reuse `PER_FILE_TIMEOUT_MS`), so a real hang is caught in tens of seconds, not five minutes.
- This does **not** attempt to fix the underlying leaked-handle bug in whichever socket test leaks;
  it makes that bug **named, bounded, and non-total** so it can be fixed surgically next. Record the
  named file the next CI occurrence reports.

## Out of scope

- Finding/fixing the specific socket-test handle leak (separate follow-up once this names it).
- Changing `bun` test semantics, parallelism of other modes, or the integration/serial paths.
- Raising the timeout as a workaround (the point is to shorten and name, not lengthen).

## Tests / verification

- `scripts/run-v2-tests.ts` agent mode, given a file that hangs past the per-file timeout, exits
  non-zero with a message naming that file (mirrors the existing integration-mode timeout test if
  one exists; add/extend a script-level test).
- `bun run test:v2` still passes locally and reports per-file results.

## Documentation updates

- `v1/docs/operator-runbook.md` (§ The gate): update the `Test (v2)` hang bullet to note agent mode
  now names and isolates a hung file per-file, so a wedge points at the offending test instead of a
  bare global kill.
