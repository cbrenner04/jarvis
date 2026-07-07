---
name: run-tests-agent-mode-per-file-timeout
---

# `scripts/run-tests.ts` agent mode gets per-file timeout isolation

`scripts/run-tests.ts` agent mode currently runs all agent files in one unbounded
`bun test --parallel` call. Route it through the same per-file spawn/timeout/continue-on-timeout
loop `run-v2-tests.ts` exports (`runV2TestFiles`/`aggregateExitCode`), so a hung file is named
and isolated instead of wedging the whole gate.

## Decisions

- Replace `run-tests.ts`'s `bun test --parallel` agent-mode call with the shared
  per-file loop, applying the same `PER_FILE_TIMEOUT_MS` and continue-on-timeout semantics.

## Out of scope

- `run-tests.ts`'s integration-mode loop (already serial, per-file).
- Fixing any specific leaked-handle hang.

## Tests / verification

- `scripts/run-tests.ts` agent mode, given a file that hangs past `PER_FILE_TIMEOUT_MS`, exits
  non-zero naming that file and still runs the remaining agent files.

## Documentation updates

- None identified; confirm during planning.

## Prerequisites
