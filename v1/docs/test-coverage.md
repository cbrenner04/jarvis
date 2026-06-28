# Test Coverage

Jarvis provides parallel coverage measurement scripts — one per test slice — to complement the `test` / `test:*` commands.

## Coverage scripts

| Command | Slice | Files | Coverage destination |
| --- | --- | --- | --- |
| `bun run coverage` | All | v1, v2, shared, scripts, root tests | Stdout table |
| `bun run coverage:v1` | v1 | `v1/src/`, `v1/test/` | Stdout table |
| `bun run coverage:v2` | v2 | `v2/` (includes sandbox-unrunnable tests) | Stdout table |

`coverage:v2` intentionally covers all of `v2/`, including `*.sandbox-unrunnable.test.ts` files excluded from agent-runnable `test:v2`. Sources: `package.json`, `scripts/v2-test-files.ts`, `v2/docs/v1-behaviors.md`
| `bun run coverage:shared` | Shared infrastructure | `shared/`, `scripts/`, `./test/` (root) | Stdout table |

Each command runs Bun's built-in coverage reporter, which prints a summary table to stdout with line coverage percentages for each file. No coverage artifacts are written to disk.

## Reading Bun's coverage output

Bun's text reporter groups files under each top-level directory and shows per-file and per-slice aggregate coverage:

```
------|---------|---------|---------|---------|
File  | % Stmts | % Branch | % Funcs | % Lines |
------|---------|---------|---------|---------|
All files  |  XX.XX |   XX.XX |  XX.XX |  XX.XX |
 v1/src    |  XX.XX |   XX.XX |  XX.XX |  XX.XX |
 v1/src/foo.ts |  XX.XX |   XX.XX |  XX.XX |  XX.XX |
```

Columns:
- **% Stmts**: statement coverage — how many executable statements ran at least once.
- **% Branch**: branch coverage — how many conditional branches (if/else, switch cases) were executed.
- **% Funcs**: function coverage — how many defined functions were called.
- **% Lines**: line coverage — how many source lines were executed.

## Current non-goals

Thresholds, `ready` integration, and no-drop guards are deferred pending a first consumer (reviewer, dashboard, or CI gate).
