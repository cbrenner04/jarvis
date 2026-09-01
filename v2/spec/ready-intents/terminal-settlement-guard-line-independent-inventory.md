---
name: terminal-settlement-guard-line-independent-inventory
---

# Terminal-settlement guard inventory keys ignore line drift

Unsplit rationale: Inventory keying, permitted-write deduplication, and line-drift regression all live in `execution-terminal-settlement-guard.test.ts` on the execution-loop guard seam; no persistence, daemon, or CLI boundary changes.

## Primary implementation surface

- `v2/src/execution/execution-terminal-settlement-guard.test.ts`

## Prerequisites

- Execution production terminal-write guard scans `v2/src/execution/**` production sources and enforces atomic settlement via an explicit permitted-write inventory.
- `execution-terminal-settlement-guard.test.ts` test `guard rejects reintroduced terminal setRunStatus` proves the scanner detects forbidden terminal `setRunStatus` via a `// @mutate` checkpoint.

## Problem

`PERMITTED_TERMINAL_WRITES`, `PERMITTED_NONTERMINAL_SET_RUN_STATUS`, and `terminalWriteKey` / `nonterminalSetRunStatusKey` embed absolute line numbers. Unrelated edits above a tracked call site shift line numbers and redden the guard even when `violations` is empty and the settlement invariant is intact.

## Behavior

- Compare permitted and scanned terminal-write inventories using `(file, functionName, writer)` and nonterminal `setRunStatus` using `(file, functionName, status)`; keep `line` on violation reports for humans only.
- Collapse duplicate permitted entries that share the same key when multiple settlement calls exist in one function.
- Add a regression that inserts blank lines above a tracked call site and asserts the guard stays green.

## Decision ledger

- Drop `line` from `terminalWriteKey` and `nonterminalSetRunStatusKey`; rules out inventory equality keyed on absolute source position.
- Permit multiple call sites per `(file, functionName, writer)` via count or multiset comparison rather than per-line inventory rows; rules out re-adding a line entry for every intra-function settlement call.
- Preserve fail-closed violation detection for forbidden `setRunStatus`, standalone `setPrEvidence`, and unsettled terminal `commitCompletionBoundary`; rules out weakening the scanner to fix inventory drift.
- `execution-terminal-settlement-guard.test.ts` test `guard rejects reintroduced terminal setRunStatus` stays green; rules out regressing the existing mutation checkpoint.

## Acceptance criteria

- [ ] `execution-terminal-settlement-guard.test.ts` test `inventory ignores line drift above tracked call sites` inserts blank lines above a tracked production settlement call, reruns the guard, and asserts no inventory mismatch while `violations` stays empty; it fails against the pre-fix line-keyed inventory.
- [ ] `execution-terminal-settlement-guard.test.ts` test `guard rejects reintroduced terminal setRunStatus` stays green.
- [ ] `terminalWriteKey` and `nonterminalSetRunStatusKey` omit `line` from their returned equality strings.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/src/execution/execution-terminal-settlement-guard.test.ts` — header comment states inventory keys are `(file, functionName, writer/status)` and intentionally omit line numbers.
