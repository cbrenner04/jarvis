# Seed: completion gate reports green while a sandbox-unrunnable integration test is red

## Problem

The v2 completion ready gate runs `bun run test` (the aggregate suite), which **excludes**
`*.sandbox-unrunnable.test.ts` — those only run sandbox-off. But an implement run's acceptance
criteria routinely name `bun run test:integration:v2` (and `test:v2`), whose sandbox-off scope
**does** include the socket-backed `.sandbox-unrunnable.test.ts` integration files.

So a change can:

1. break a pre-existing socket-backed integration test (e.g. enrich the daemon status response so
   `daemon.sandbox-unrunnable.test.ts`'s exact `.toEqual({ state: "running" })` fails),
2. have the agent tick the AC "`bun run test:integration:v2` pass" without running that file, and
3. pass the completion gate green anyway (the gate's `bun run test` never runs the file),

publishing a `completed` PR over a deterministically-red integration suite.

Observed 2026-07-18 on PR #1751 (`daemon-status-reports-source-snapshot`, Wave 3.1): implementation
logic correct, gate green, AC ticked — yet `bun test v2/src/daemon/daemon.sandbox-unrunnable.test.ts`
fails sandbox-off with `Received + "loadedRevision": "4ee9e7cd…"`. Caught only by adversarial mutation
review, not by any gate. This is a direct instance of "a green gate is not evidence the code runs" and
the reason mutation review stays mandatory.

## Decisions

- The completion gate must either run the sandbox-unrunnable integration files (when the gate runs in
  an environment that can — the daemon is not sandboxed) or fail the AC that claims
  `test:integration:v2 pass` when that scope was not actually executed. A ticked "integration tests
  pass" AC must not be satisfiable while `test:integration:v2` is red sandbox-off.
- At minimum, surface the gap: an implement run whose AC names `test:integration:v2` must not report
  `completed` if the sandbox-unrunnable integration files in that scope are red.

## Acceptance criteria

- [ ] A change that breaks a socket-backed `*.sandbox-unrunnable.test.ts` integration test cannot reach
      `runStatus: completed` with that AC ticked — the completion gate (or a finalize check) catches the
      red integration file.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — note the gate's `bun run test` excludes
  sandbox-unrunnable files and what closes the gap; delete the mutation-review stopgap only when this
  and `implement-completion-requires-adversarial-mutation-verification` both ship.
