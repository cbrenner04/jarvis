# 00 - `run workflow` blocks on the run and mirrors its exit code

## Problem

`jarvis run workflow <name>` (`v2/src/cli.ts`, `runWorkflowCommand`) prints the run id
and returns `0` as soon as the daemon accepts the `start` request. A run that lands
`runStatus: failed` seconds later still exits `0`, so no script or gate can trust the
shell status.

`jarvis run wait <run-id>` already blocks on the daemon `wait` RPC and maps the
completion result to an exit code (`exitCodeForWaitResult` / `buildWaitPayload`,
`v2/src/cli.ts`). Reuse it; do not invent a second mapping.

## Decisions

- After a successful `start`, `run workflow` issues the same daemon `wait` request for the
  returned run id on the same client, and returns `exitCodeForWaitResult` of the result —
  rules out a workflow-local status→exit table.
- Extract the existing `run wait` body (request → `parseWaitCompletion` → `buildWaitPayload`
  stdout line → `exitCodeForWaitResult`) into one helper used by both `run wait` and
  `run workflow`, so the two exit contracts cannot drift.
- One `wait` per invocation, no re-wait loop: a workflow run resolves at its single
  `loop_finished` / `run_execution_failed` boundary, and a non-terminal boundary (e.g. an
  operator `pause`) exits exactly as `run wait` does today — rules out a bespoke
  poll-until-terminal loop in the CLI.
- Stdout stays additive: the run-id line first (unchanged), then the wait JSON line. Rules
  out replacing the run-id line, which operators and the runbook already read.
- `wait` RPC errors and malformed payloads follow the existing `run wait` handling (stderr +
  exit `1`).
- No `--detach` / `--no-wait` flag: no current caller needs it.
  Deferred to first consumer: opt-out of blocking — pin when a caller needs it.

## Acceptance criteria

- [ ] `jarvis run workflow <name>` blocks after the daemon accepts the start request and exits
      only once the run reaches its terminal boundary.
- [ ] A workflow run that ends `runStatus: failed` exits `3`; a killed run exits `4`; a
      successful run exits `0` — same mapping `jarvis run wait` produces for the same run.
- [ ] Stdout carries the run id line followed by the `run wait` JSON line
      (`{runStatus, loopOutcomeKind?, ...}`); the intent-preset `intent paths:` stderr line is
      unchanged.
- [ ] Pre-daemon failures (unknown preset, bad flags, spec outside registered projects,
      machine-config failure) still exit `1` without connecting to the daemon — existing
      `v2/src/cli.ts` workflow tests stay green.
- [ ] `jarvis run wait <run-id>` output and exit codes are unchanged by the extraction
      (`v2/src/cli.test.ts` wait tests stay green).
- [ ] `bun test v2/src/cli.test.ts` covers a workflow run whose wait result is `failed`
      (exit `3`) and one that completes (exit `0`).

## Documentation updates

- `v2/docs/write-behavior.md` — run-control CLI table: `run workflow` exit column now points at
  [wait exit codes](../../docs/write-behavior.md#wait-exit-codes) and the blocking contract;
  note the run-id + wait-JSON stdout.
- `v2/docs/operator-runbook.md` — delete the "`run workflow` exits 0 on a failed run" gotcha
  bullet; update the run-control table entry.
- `v2/docs/v1-behaviors.md` — update the `jarvis run workflow` entry (line ~233) with the
  blocking + exit-status contract.
