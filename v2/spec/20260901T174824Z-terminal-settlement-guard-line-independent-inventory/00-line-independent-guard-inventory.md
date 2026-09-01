# Line-independent guard inventory

## Problem

`PERMITTED_TERMINAL_WRITES`, `PERMITTED_NONTERMINAL_SET_RUN_STATUS`, and `terminalWriteKey` / `nonterminalSetRunStatusKey` embed absolute line numbers. Unrelated edits above a tracked call site shift line numbers and redden the guard even when `violations` is empty and the settlement invariant is intact.

## Surface

`v2/src/execution/execution-terminal-settlement-guard.test.ts` only — inventory key helpers, permitted-write tables, inventory comparison, and guard regressions. No persistence, daemon, CLI, or production execution-module changes.

## Decision ledger

- Inventory equality keys terminal writes on `(file, functionName, writer)` and nonterminal `setRunStatus` on `(file, functionName, status)`; rules out absolute source line in `terminalWriteKey` / `nonterminalSetRunStatusKey`.
- Compare scanned versus permitted inventories by occurrence count per key (multiset semantics); rules out unique-key set inclusion or one permitted row per key without an explicit count.
- After `line` is removed from keys, permitted multiplicity is preserved — N identical-key rows or one row per key with an explicit count — matching scanned occurrence counts; rules out collapsing duplicate-key permitted rows to a single row without count tracking.
- Remove `line` from `PermittedTerminalWrite` / `PermittedNonterminalSetRunStatus` types and permitted constant rows; keep `line` on scan-discovered sites and `TerminalSettlementViolation` for human-readable reports; rules out dropping `line` only from comparison while leaving it on permitted types.
- `inventoryMismatchMessage` detects missing keys, extra keys, and count deltas per key for both terminal-write and nonterminal inventories; rules out per-entry set-inclusion (`includes`) comparison.
- Preserve fail-closed scanner behavior for forbidden terminal `setRunStatus`, standalone `setPrEvidence`, and unsettled terminal `commitCompletionBoundary`; rules out weakening violation detection to silence inventory drift.
- `execution-terminal-settlement-guard.test.ts` test `guard rejects reintroduced terminal setRunStatus` stays green; rules out regressing the existing `// @mutate` checkpoint.

## Work

- Change `terminalWriteKey` and `nonterminalSetRunStatusKey` to omit `line` from returned equality strings.
- Remove `line` from `PermittedTerminalWrite` / `PermittedNonterminalSetRunStatus` types and permitted constant rows.
- Replace set-equality inventory comparison with occurrence-count-per-key comparison for both inventories; update `inventoryMismatchMessage` to detect missing keys, extra keys, and count deltas.
- Preserve permitted multiplicity after keying change: N identical-key rows or one row per key with explicit count — do not collapse to one row per unique key.
- Add test `inventory ignores line drift above tracked call sites` that inserts blank lines above a tracked production settlement call via source overrides, reruns the guard, and asserts no inventory mismatch while `violations` stays empty.
- Add a header comment stating inventory keys are `(file, functionName, writer/status)` and intentionally omit line numbers.

## Acceptance criteria

- [ ] `v2/src/execution/execution-terminal-settlement-guard.test.ts` test `inventory ignores line drift above tracked call sites` inserts blank lines above a tracked production settlement call, reruns the guard, and asserts no inventory mismatch while `violations` stays empty; it fails against the pre-fix line-keyed inventory.
- [ ] `v2/src/execution/execution-terminal-settlement-guard.test.ts` test `guard rejects reintroduced terminal setRunStatus` stays green.
- [ ] `v2/src/execution/execution-terminal-settlement-guard.test.ts` test `execution production terminal writers are restricted to atomic settlement` stays green.
- [ ] `v2/src/execution/execution-terminal-settlement-guard.test.ts` `terminalWriteKey` and `nonterminalSetRunStatusKey` omit `line` from their returned equality strings.
- [ ] `v2/src/execution/execution-terminal-settlement-guard.test.ts` header comment states inventory keys are `(file, functionName, writer/status)` and intentionally omit line numbers.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/src/execution/execution-terminal-settlement-guard.test.ts` — header comment states inventory keys are `(file, functionName, writer/status)` and intentionally omit line numbers.
