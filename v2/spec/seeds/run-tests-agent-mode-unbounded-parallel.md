---
name: run-tests-agent-mode-unbounded-parallel
---

# `scripts/run-tests.ts` agent-mode run still lacks per-file timeout isolation

`scripts/run-v2-tests.ts` agent mode now runs each agent file serially with a per-file
`PER_FILE_TIMEOUT_MS` timeout that names the hung file (see
`v2/spec/2026-07-06T19-28-31Z-agent-mode-v2-tests-per-file-timeout/`). `scripts/run-tests.ts`
(the combined `bun run test` gate) does not delegate to that logic: it collects `aggregateTestFiles().agent`
(v1 + v2 + shared/harness agent files) and runs them in one `bun test --parallel <files>` call with
no timeout at all — not even the old global `AGENT_MODE_TIMEOUT_MS`. A hang in any of those files
wedges the whole `bun run test` gate indefinitely, unnamed, the same undifferentiated-hang failure
mode this spec fixed for `run-v2-tests.ts`'s own agent mode.

## Decisions

- Route `scripts/run-tests.ts`'s agent-mode run through the same shared per-file
  spawn/timeout/continue-on-timeout loop `run-v2-tests.ts` now uses, instead of its own
  `bun test --parallel` call.

## Out of scope

- Changing `run-tests.ts`'s integration-mode loop (already serial, per-file).
- Fixing any specific leaked-handle hang.

## Tests / verification

- `scripts/run-tests.ts` agent mode, given a file that hangs past `PER_FILE_TIMEOUT_MS`, exits
  non-zero naming that file and still runs the remaining agent files.

## Documentation updates

- None identified; confirm during planning.
