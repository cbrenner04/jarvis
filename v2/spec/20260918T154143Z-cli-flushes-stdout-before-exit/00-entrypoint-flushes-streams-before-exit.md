# Entrypoint flushes stdout/stderr before exit

## Problem

`v2/src/cli.ts:144` calls `process.exit(await main(...))` immediately; piped output over 64 KiB is truncated (`pipeline list --all --json | wc -c` → `65536` on main).

## Decisions

- Flush in the entrypoint only (after `main` resolves, before `process.exit`); do not restructure `main` or per-command writers — the truncation is an exit-path bug, not a writer bug.
- Flush by awaiting the callback of an empty `write("")` on each of `process.stdout` and `process.stderr`; do not wait on `drain` — it never fires when nothing is buffered and would hang the CLI.
- The flush wait also resolves on stream `error`/`close` (reader closed early, e.g. `| head`), so the CLI exits instead of hanging; `main`'s exit code is kept.
- Keep `process.exit(code)` with `main`'s code; do not replace with `process.exitCode` and natural exit — open daemon handles could keep the process alive.
- Test payloads must be well above pipe capacity (≥1 MiB stdout) so truncation reproduces on any OS; pipe size and read timing differ across platforms.
- Expected stdout length comes from serializing the same command's JSON output in-process against the same seeded store.
- The stderr fixture is an unknown command name (`unknown command: <name>`, exit 1) — existing behavior, no test-only hooks. Argv caps the name below 1 MiB (Linux ~128 KiB per arg), so use the largest name argv allows (>64 KiB); stdout carries the pre-fix failure proof.

## Task checklist

- [ ] Await stdout and stderr flush before `process.exit` in `v2/src/cli.ts`.
- [ ] Add spawn test covering ≥1 MiB stdout and >64 KiB stderr with non-zero exit.

## Acceptance criteria

- [ ] A new v2 test spawns the real CLI with stdout and stderr piped against a fixture state store seeded so `pipeline list --all --json` emits at least 1 MiB, and asserts the full stdout parses as JSON with a byte length equal to the same command's JSON serialized in-process from that store; it fails against the pre-fix entrypoint (reachable on main: `pipeline list --all --json | wc -c` → `65536`).
- [ ] The same test spawns the CLI with an unknown command name longer than 64 KiB and asserts the full `unknown command: <name>` stderr arrives and the exit code is 1.
- [ ] A spawn test whose stdout reader closes early (e.g. reads a few bytes then destroys the pipe) asserts the CLI still exits with `main`'s exit code and does not hang.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None: bug fix restoring intended output; no v1 parity impact.
