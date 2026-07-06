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
  and continue to the next file — rules out one hung file wedging the whole run, the intent's
  explicit ask.
- An ordinary (non-timeout) non-zero exit keeps integration mode's existing fail-fast semantics:
  the run stops and reports that file's failure — rules out silently widening agent mode's
  current fail-fast-on-failure behavior beyond what the intent asked for; the intent scopes
  "continue past" to timeouts only.
- Because control flow is now identical between modes (serial spawn, per-file timeout, timeout
  message, continue past timeout, fail-fast on ordinary failure), extract one shared function
  parameterized by mode name and file list, taking an injected `spawn` call per
  [`v2/docs/test-writing.md`](../../docs/test-writing.md)'s DI convention, and have both agent
  mode and integration mode call it — rules out maintaining two copies of the same loop.
- Dropping `--parallel` means agent-mode files now run serially, increasing agent-mode wall-clock
  time — a foreseeable consequence of mirroring integration mode's serial structure, not a hidden
  regression.
- Before relying on `PER_FILE_TIMEOUT_MS` for agent-mode files, the implementer confirms no
  existing agent-mode test file legitimately runs longer than it standalone — an unverified
  budget could turn CI green today into a false-positive timeout.
- The shared loop returns a per-file result list; the caller derives the aggregate exit code.

## Out of scope

- Fixing the underlying leaked-handle bug in whichever socket test hangs.
- Changing `bun` test semantics or parallelism of other modes; integration mode's observable
  behavior is unchanged even though it now calls the shared loop function.
- Raising the timeout as a workaround.

## Acceptance criteria

- [ ] Agent mode's `--parallel` invocation and `AGENT_MODE_TIMEOUT_MS` are removed from
      `scripts/run-v2-tests.ts`; agent mode spawns each file serially via its own `spawnSync`
      call using `PER_FILE_TIMEOUT_MS`.
- [ ] On a per-file timeout, agent mode prints `spawnTimeoutMessage("agent", file)` naming the
      hung file, kills that file's process, and continues running the remaining files instead of
      aborting the run.
- [ ] An ordinary (non-timeout) failing file stops the agent-mode run, reporting that file's
      failure, matching integration mode's existing fail-fast behavior.
- [ ] Agent mode can no longer report the undifferentiated `error: v2 "agent" test run timed out
      or was killed` message — a hang always names the offending file instead.
- [ ] Agent mode and integration mode's per-file loops are driven by one shared function; no
      duplicated spawn/timeout/continue logic between the two modes.
- [ ] `scripts/run-v2-tests.test.ts` exercises the continue-past-timeout loop via an injected fake
      `spawn` (no real subprocess), asserting: the timeout message names the hung file, a
      later file in the list still runs, and the aggregate result is non-zero.
- [ ] Before landing, every existing agent-mode test file is confirmed to run standalone within
      `PER_FILE_TIMEOUT_MS` (no false-positive timeout introduced).
- [ ] `bun run test:v2` passes locally and reports per-file results for agent-mode files.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate: add a bullet noting agent-mode `Test (v2)` hangs are
  isolated and named per-file (mirroring integration mode), not a bare global 300s kill.
