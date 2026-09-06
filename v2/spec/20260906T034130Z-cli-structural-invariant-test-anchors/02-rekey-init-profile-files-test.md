# Re-key v2/src/commands/init.test.ts profile filenames

## Problem

Row `cli-init-profile-files` in `v2/docs/structural-invariant-test-audit.md` pins committed machine profile filenames to a hardcoded `["home.json", "work.json"]` equality beside `readdirSync(MACHINE_PROFILES_DIR)`.

## Decision ledger

- Profile filename inventory asserts sorted `*.json` basenames under imported `MACHINE_PROFILES_DIR` match the directory contents, not a duplicated literal array in the test; rules out hardcoded `["home.json", "work.json"]` as the expected set.
- Bootstrap behavioral cases in the same describe block stay unchanged; rules out replacing init integration coverage with directory listing only.

## Task checklist

- [x] Re-key audit row `cli-init-profile-files` per the decision ledger.
- [x] Keep `profile bindings govern bootstrap and runnable roster` behavioral coverage intact while re-keying only the filename inventory assertion.

## Acceptance criteria

- [x] `v2/src/commands/init.test.ts` test `profile bindings govern bootstrap and runnable roster` derives expected machine profile filenames from sorted `readdirSync(MACHINE_PROFILES_DIR)` discovery rather than a hardcoded literal array; it fails against the pre-fix `["home.json", "work.json"]` pin reachable in that test and passes after re-key.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
