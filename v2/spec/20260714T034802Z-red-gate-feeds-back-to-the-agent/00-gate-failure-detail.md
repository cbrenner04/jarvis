# 00 - Gate failure carries command, exit code, and output

The ready finalizer today collapses a red gate into a message string built from stderr only
(`ready gate failed (exit N): <stderr>`). The repair loop in `01` needs the gate's command, exit
code, and full output as data, not prose.

## Decisions

- The gate throws a typed `ReadyGateError` (exported from `v2/src/execution/ready-finalize.ts`) carrying `command`, `exitCode` (`number | undefined`), and `output`. Rules out re-parsing the message string downstream.
- `output` is stdout and stderr concatenated in that order. Rules out stderr-only capture: `bun run ready` failures (test output, biome diffs) land on stdout.
- The thrown error's `message` keeps today's `ready gate failed (exit N): …` prefix so existing operator-facing surfaces and `readyFinalizeError` text are unchanged. Rules out a message rewrite that would churn tests and logs for no operator gain.
- Flip failures (`gh pr ready`) stay plain `Error`s. Rules out treating an unreachable GitHub as a repairable gate.

## Task checklist

- [ ] Add `ReadyGateError` and throw it from the default gate runner, capturing stdout+stderr from `AsyncSubprocessError`.
- [ ] Cover it in `v2/src/execution/ready-finalize.test.ts`.
- [ ] Update `v2/docs/write-behavior.md` ready-finalization paragraph.

## Acceptance criteria

- [ ] A red `bun run ready` surfaces an error carrying the gate command, its exit code, and its combined stdout+stderr output as separate fields; a new `ready-finalize.test.ts` case asserts this and fails against the pre-fix code.
- [ ] The failure message still reads `ready gate failed (exit N): …`; existing `ready-finalize.test.ts` cases stay green.
- [ ] A `gh pr ready` failure is not reported as a gate failure (existing flip-retry tests stay green).

## Documentation updates

- `v2/docs/write-behavior.md` — ready finalization: the gate failure now carries command, exit code, and combined output.
