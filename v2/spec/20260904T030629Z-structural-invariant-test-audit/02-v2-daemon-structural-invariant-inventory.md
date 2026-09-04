# v2 daemon structural-invariant inventory

## Problem

Subspec 00 published discovery contract and the candidate manifest. This slice inventories every in-scope structural-invariant anchor under `v2/src/daemon/**`.

## Decisions

- Scope is `v2/src/daemon/**/*.test.ts` files classified `in-scope` in the candidate manifest; rules out other v2 trees in this subspec.
- Rows follow the output schema and classification rubric in [00-audit-discovery-methodology.md](./00-audit-discovery-methodology.md); rules out alternate row shapes per slice.
- Inventory appends to `v2/docs/structural-invariant-test-audit.md` under a `## v2 daemon inventory` heading; rules out a separate artifact per slice.

## Task checklist

- [ ] For each manifest `in-scope` file under `v2/src/daemon/**`, read every case and record one row per in-scope anchor (guarded invariant, anchor mechanism, classification, disposition, `vacuous-pass-risk` when applicable).
- [ ] Tag every `incidental` row `re-key` or `stay-incidental`; add a one-line `stay-incidental-rationale` on each `stay-incidental` row.

## Acceptance criteria

- [ ] Every manifest `in-scope` file under `v2/src/daemon/**` has ≥1 inventory row in `v2/docs/structural-invariant-test-audit.md`.
- [ ] Every `v2/src/daemon/**` inventory row cites a manifested file and includes `row-id`, `test-path`, `case-scope`, `guarded-invariant`, `anchor-mechanism`, `classification`, `disposition` (and `stay-incidental-rationale` when required, `vacuous-pass-risk` when applicable).
- [ ] Every `v2/src/daemon/**` `incidental` row is tagged `re-key` or `stay-incidental` with a one-line rationale on each `stay-incidental` row.

## Documentation updates

None — inventory rows live in `v2/docs/structural-invariant-test-audit.md`.
