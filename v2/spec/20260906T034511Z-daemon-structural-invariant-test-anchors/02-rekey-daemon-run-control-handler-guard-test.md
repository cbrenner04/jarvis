# Re-key daemon-run-control-handler-guard.test.ts

## Problem

Row `dm-rchg-forbidden-weakmap-symbols` in `v2/docs/structural-invariant-test-audit.md` pins the forbidden-symbol guard to a test-local literal list scanned across production sources, so policy growth or scanner relocation passes vacuously when symbols move off the hardcoded set (`vacuous-pass-risk: yes`).

## Decision ledger

- Forbidden symbols resolve from the scanner module's exported policy set, not a duplicated test-local `FORBIDDEN_SYMBOLS` literal; rules out drift between scanner and guard oracle.
- Production daemon sources are discovered by recursive walk of `v2/src/daemon/**/*.ts` excluding tests, not a flat directory listing; rules out missed nested production modules.

## Task checklist

- [x] Re-key audit row `dm-rchg-forbidden-weakmap-symbols` per the decision ledger.
- [x] Export or import the forbidden-symbol policy from the scanner's source of truth.

## Acceptance criteria

- [x] `daemon-run-control-handler-guard.test.ts` test `daemon production sources omit activeRunsByHandler and activeRunForHandler` derives forbidden symbols from the scanner policy export rather than a test-local literal list; it fails against the pre-fix `FORBIDDEN_SYMBOLS` literal on audit row `dm-rchg-forbidden-weakmap-symbols` (`vacuous-pass-risk: yes`) and passes after re-key.
- [x] `daemon-run-control-handler-guard.test.ts` test `guard reports reintroduced activeRun WeakMap back-channel symbols` stays green.
- [x] `bun run typecheck` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
