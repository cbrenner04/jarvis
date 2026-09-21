# Prove cross-surface failure block identity

## Problem

Nothing asserts that `run list`, `run wait`, `pipeline list`, and TUI detail render the same block for one record.

## Behavior

One regression drives a single record through all four surfaces and asserts byte-identical extracted blocks; surrounding output may differ.

## Decisions

- Extraction uses the boundary contract from subspec 00: from the `failure:` line through the last consecutive two-space-indented line, after stripping only the host row prefix; rules out fuzzy or field-name-based extraction.
- Cross-surface identity is the extracted block only; rules out treating surface-specific identity, status, or timestamps as drift.
- The fixture record includes a near miss, both path origins, and a control character so encoding is exercised end to end.

## Task checklist

- [ ] Add the cross-surface identity regression.
- [ ] Record the v2 cross-surface behavior in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A regression in `v2/src/cli/operator-failure-cross-surface.test.ts` passes one record through `run list`, `run wait`, `pipeline list`, and TUI detail, extracts each block by the documented boundary, and asserts byte-identical content while surrounding output differs; it fails against the pre-fix omissions and TUI raw JSON.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the v2 cross-surface failure presentation behavior.
