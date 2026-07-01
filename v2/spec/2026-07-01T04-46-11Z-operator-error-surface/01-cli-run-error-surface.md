# 01 — CLI run error surface

Render daemon `error` detail on the thin CLI `jarvis run list` and
`jarvis run wait` outputs. Actionable summary only — no stderr dumps or log
transcripts in default output.

## Prerequisites

- Merged `00-run-operator-error-detail` (`error` on daemon `list` / `wait`).

## Decisions

- `jarvis run list` and `jarvis run wait` are the only CLI surfaces in this
  spec — rules out TUI layout changes and new detail subcommands.
- TUI log/run views unchanged — rules out parity with thin CLI `error` fields in
  this slice (operators using both see different surfaces until a future TUI
  slice).
- Pass through daemon `error` fields verbatim — rules out local
  reclassification or prose synthesis in the CLI.
- `jarvis run list`: eight tab-separated columns
  (`runId`, `project`, `branch`, `status`, `liveness`, `reason`, `retryable`,
  `nextAction`); emit `-` in the last three when `error` absent — rules out
  per-row column omission (stable width for scripts; breaks positional
  five-column parsers).
- `jarvis run wait`: include `error` keys in the existing minified JSON stdout
  when present; omit the `error` key when absent — rules out `null` placeholders.
- `wait` exit codes follow the existing `loopOutcomeKind` / `runStatus` matrix;
  `error` is informational stdout only (e.g. `retryable: true` with exit `4` on
  `killed`) — rules out coupling exit codes to `error.reason` in this slice.
- Deferred to first consumer: dedicated human-readable error-only command or
  flags — pin when command names are stable.

## Task checklist

- Extend `jarvis run list` formatting for optional daemon `error` columns.
- Extend `jarvis run wait` JSON stdout to include present `error` object.
- Co-locate CLI tests: list rows with and without `error`; wait JSON with and
  without `error`; malformed daemon payloads still exit `1`.
- Update operator docs per Documentation updates.

## Acceptance criteria

- [x] `jarvis run list` prints tab-separated rows with columns `runId`, `project`, `branch`, `status`, `liveness`, `reason`, `retryable`, `nextAction`; when daemon omits `error`, the last three columns are `-` (CLI test, injected IPC fake).
- [x] `jarvis run list` prints `reason`, `retryable`, and `nextAction` from daemon `error` when present (CLI test, e.g. `harness_failure` row).
- [x] `jarvis run wait <run-id>` stdout JSON includes an `error` object with `reason`, `retryable`, and `nextAction` when the daemon `wait` result carries `error` (CLI test).
- [x] `jarvis run wait <run-id>` omits the `error` key when the daemon result has no `error` (CLI test).
- [x] `jarvis run wait` exit-code matrix from `v2/src/cli.test.ts` stays green (behavior unchanged by error fields).
- [x] `jarvis run list` and `jarvis run wait` still pass through connection and RPC errors as `<code>: <message>` on stderr with exit `1` (CLI test).
- [x] `v2/docs/write-behavior.md` documents the eight-column list layout, `-` placeholder semantics, breaking change for positional five-column parsers, wait JSON `error` shape, exit-code decoupling from `error`, TUI unchanged stance, and that default output excludes stderr/transcripts; points wire contract to `daemon-host.md`.
- [x] `v2/docs/v1-behaviors.md` has a `[v2 additive]` entry for structured run error fields on `jarvis run list` / `jarvis run wait`, including list column-width migration note.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — eight-column list layout, `-` placeholders,
  parser migration, wait JSON `error` fields, exit-code decoupling, TUI gap,
  actionable-summary-only stance.
- `v2/docs/v1-behaviors.md` — `[v2 additive]` entry under run-control CLI with
  column migration note.
