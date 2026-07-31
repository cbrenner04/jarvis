---
name: guard-production-test-flags
---

# Static guard rejects production invert-for-test hooks

## Problem

Review alone missed `setInvert*ForTest` exports, `invert*ForTest` module variables, `invert*`
parameters, and `invert*ForTest` type members across `v2/src/**`, `v1/src/**`, and `shared/**`.
A guard matching only exports would miss the parameter shape that costs mutation-verification runs.

## Decisions

- `scripts/guard-production-test-flags.ts` scans `v2/src/**`, `v1/src/**`, and `shared/**` excluding `*.test.ts` for all four shapes — rules out export-only matching.
- The guard runs under `bun run check` beside existing guards with fixture pass/fail cases — rules out a standalone script operators forget.
- No production allowlist: every pre-existing hook is removed by earlier intents — rules out shipping named follow-up allowlist entries.
- Inverting the guard's `.test.ts` extension check must RED a guard test — rules out untested enforcement.

## Acceptance criteria

- [ ] `scripts/guard-production-test-flags.ts` fails on fixtures exporting `setInvertFooForTest` from a non-test file under `v2/src/**`, `v1/src/**`, or `shared/**`, and passes when the symbol lives in a `.test.ts` file.
- [ ] The same guard fails on non-test fixtures declaring an `invert*` / `*ForTest` function parameter or an `invert*ForTest` type member; matching `.test.ts` fixtures pass.
- [ ] Inverting the file-extension check makes a test in `scripts/guard-production-test-flags.test.ts` RED.
- [ ] `bun run check`, `bun run typecheck`, and full `bun run test` pass with zero production allowlist entries.

## Documentation updates

- `v2/docs/coding-standards.md` — no production state exists solely for tests; `bun run check` rejects invert-for-test hooks.
- `v2/docs/test-writing.md` — note the static guard under `bun run check` (if not already covered by write-step-rules doc pass).

## Prerequisites

- Plan and implement write-step rules name comment-checkpoint source mutation and forbid production invert hooks.
- Daemon production modules export no `setInvert*ForTest` or `invert*ForTest` hooks.
- CLI production modules export no `setInvert*ForTest` or `invert*ForTest` hooks.
- Execution-loop and TUI production modules carry no forbidden invert hooks in any shape.
- Shared production modules export no `setInvert*ForTest` or `invert*ForTest` hooks.
