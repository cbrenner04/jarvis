# Re-key execution-terminal-settlement-guard.test.ts

## Problem

Row `ex-etsg-permitted-inventory` in `v2/docs/structural-invariant-test-audit.md` pins terminal and nonterminal settlement sites to `PERMITTED_TERMINAL_WRITES` and `PERMITTED_NONTERMINAL_SET_RUN_STATUS` literals duplicated in the test file, so legitimate new settlement call sites red-gate until a human copies the scanner output into the test inventory.

## Decision ledger

- Permitted terminal and nonterminal write inventories are exported from the guard module (or a co-located registry the scanner owns), not duplicated as test-local arrays; rules out `PERMITTED_*` literals maintained beside the scanner.
- Inventory comparison keeps semantic keys `(file, writer, functionName)` and `(file, functionName, status)` from the line-independent guard work; rules out reintroducing line numbers into inventory keys.
- Production source reads for the guard route through shared loud-failure locators when slicing is needed; rules out silent empty slices when a tracked file disappears.

## Task checklist

- [ ] Re-key audit row `ex-etsg-permitted-inventory` per the decision ledger.
- [ ] Replace duplicated permitted-write tables with imports from the owning registry module.
- [ ] Route any marker or symbol slicing through `shared/structural-test-locator.ts`.

## Acceptance criteria

- [ ] `v2/src/execution/execution-terminal-settlement-guard.test.ts` production settlement guard compares scanned sites against the exported permitted-write registry without test-local `PERMITTED_*` literal arrays; it fails against the pre-fix duplicated literals and passes after re-key.
- [ ] `execution-terminal-settlement-guard.test.ts` test `inventory ignores line drift above tracked call sites` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
