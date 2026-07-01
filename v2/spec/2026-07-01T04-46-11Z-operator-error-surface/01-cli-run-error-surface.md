# 01 — CLI run error surface

Render daemon `error` detail on the thin CLI `jarvis run list` and
`jarvis run wait` outputs. Actionable summary only — no stderr dumps or log
transcripts in default output.

## Prerequisites

- Merged `00-run-operator-error-detail` (`error` on daemon `list` / `wait`).

## Decisions

- `jarvis run list` and `jarvis run wait` are the only CLI surfaces in this
  spec — rules out TUI layout changes and new detail subcommands.
- Pass through daemon `error` fields verbatim — rules out local
  reclassification or prose synthesis in the CLI.
- `jarvis run list`: extend each tab-separated row with `reason`, `retryable`,
  and `nextAction` columns when `error` is present; emit `-` placeholders when
  absent — rules out omitting columns per row (stable column count for scripts).
- `jarvis run wait`: include `error` keys in the existing minified JSON stdout
  when present; omit the `error` key when absent — rules out `null` placeholders.
- Exit-code mapping for `wait` stays unchanged — rules out coupling exit codes to
  `error.reason` in this slice.
- Deferred to first consumer: dedicated human-readable error-only command or
  flags — pin when command names are stable.

## Task checklist

- Extend `jarvis run list` formatting for optional daemon `error` columns.
- Extend `jarvis run wait` JSON stdout to include present `error` object.
- Co-locate CLI tests: list rows with and without `error`; wait JSON with and
  without `error`; malformed daemon payloads still exit `1`.
- Update operator docs per Documentation updates.

## Acceptance criteria

- [ ] `jarvis run list` prints tab-separated rows with columns `runId`, `project`, `branch`, `status`, `liveness`, `reason`, `retryable`, `nextAction`; when daemon omits `error`, the last three columns are `-` (CLI test, injected IPC fake).
- [ ] `jarvis run list` prints `reason`, `retryable`, and `nextAction` from daemon `error` when present (CLI test, e.g. `harness_failure` row).
- [ ] `jarvis run wait <run-id>` stdout JSON includes an `error` object with `reason`, `retryable`, and `nextAction` when the daemon `wait` result carries `error` (CLI test).
- [ ] `jarvis run wait <run-id>` omits the `error` key when the daemon result has no `error` (CLI test).
- [ ] `jarvis run wait` exit-code matrix from `v2/src/cli.test.ts` stays green (behavior unchanged by error fields).
- [ ] `jarvis run list` and `jarvis run wait` still pass through connection and RPC errors as `<code>: <message>` on stderr with exit `1` (CLI test).
- [ ] `v2/docs/write-behavior.md` documents list column layout, wait JSON `error` shape, and that default output excludes stderr/transcripts; points wire contract to `daemon-host.md`.
- [ ] `v2/docs/v1-behaviors.md` has a `[v2 additive]` entry for structured run error fields on `jarvis run list` / `jarvis run wait`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — list columns and wait JSON `error` fields;
  actionable-summary-only stance.
- `v2/docs/v1-behaviors.md` — `[v2 additive]` entry under run-control CLI.
