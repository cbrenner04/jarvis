# v2 CLI and persistence structural-invariant inventory

## Problem

Subspec 00 published the discovery contract and the script-generated candidate manifest. This slice inventories every remaining in-scope structural-invariant anchor under `v2/src/persistence/**`, `v2/src/commands/**`, `v2/src/cli/**`, `v2/src/config/**`, `v2/src/tui/**`, `v2/src/ipc/**`, `v2/src/testing/**`, and co-located `v2/src/*.test.ts`.

## Decisions

- Scope is manifest `in-scope` files under `v2/src/persistence/**`, `v2/src/commands/**`, `v2/src/cli/**`, `v2/src/config/**`, `v2/src/tui/**`, `v2/src/ipc/**`, `v2/src/testing/**`, and `v2/src/*.test.ts`; rules out `v2/src/daemon/**` and `v2/src/execution/**` covered by prior subspecs.
- Rows follow the output schema and classification rubric in [00-audit-discovery-methodology.md](./00-audit-discovery-methodology.md); rules out alternate row shapes per slice.
- Inventory appends to `v2/docs/structural-invariant-test-audit.md` under a `## v2 CLI and persistence inventory` heading; rules out a separate artifact per slice.
- Closing `## Downstream re-key queue` lists every `re-key` row by stable `row-id` (grouped by `test-path` + `case-scope` with disposition counts); rules out file-path-only queues that lose mixed-incidental granularity.

## Task checklist

- [ ] For each script-emitted `in-scope` file in this slice, read every case and record one row per in-scope anchor (guarded invariant, anchor mechanism, classification, disposition, `vacuous-pass-risk` when applicable).
- [ ] Tag every `incidental` row `re-key` or `stay-incidental`; add a one-line `stay-incidental-rationale` on each `stay-incidental` row.
- [ ] Add closing `## Downstream re-key queue` aggregating all `re-key` rows from subspecs 01–04 by stable `row-id` with per-file disposition counts (no implementation here).

## Acceptance criteria

- [ ] Every script-emitted `in-scope` file in this slice has ≥1 inventory row in `v2/docs/structural-invariant-test-audit.md`.
- [ ] Every inventory row in this slice cites a manifested file and includes `row-id`, `test-path`, `case-scope`, `guarded-invariant`, `anchor-mechanism`, `classification`, `disposition` (and `stay-incidental-rationale` when required, `vacuous-pass-risk` when applicable).
- [ ] Every `incidental` row in this slice is tagged `re-key` or `stay-incidental` with a one-line rationale on each `stay-incidental` row.
- [ ] `## Downstream re-key queue` lists every audit `re-key` row by stable `row-id` grouped with disposition counts; no file-path-only summary.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — inventory rows and re-key queue live in `v2/docs/structural-invariant-test-audit.md`.
