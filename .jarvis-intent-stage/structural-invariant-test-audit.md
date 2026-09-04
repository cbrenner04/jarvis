---
name: structural-invariant-test-audit
---

# Audit structural-invariant tests for behavioral vs incidental anchors

## Problem

Structural-invariant tests under `v2/src/**` and `shared/**` pin real invariants to incidental structure — line numbers, copied registry literals, hand-maintained file lists, symbol names, one-way absence checks — so sound refactors red-gate or pass vacuously. No durable inventory exists to drive re-keying or justify exceptions.

## Behavior

- Publish a durable audit artifact under `v2/docs/` listing every test that reads production source, pins symbol/file locations, or mirrors a registry.
- For each entry, record the guarded invariant, the anchor mechanism, and whether the anchor is behavioral or incidental.
- Mark incidental anchors slated for re-keying in a later intent or document why the anchor must stay incidental.

## Decision ledger

- Audit artifact lives in `v2/docs/` as the single durable home; rules out a spec-local-only checklist that plan runs cannot reuse.
- Inventory scope is tests under `v2/src/**` and `shared/**` that read source, pin locations, or mirror registries; rules out auditing unrelated behavioral tests that never touch production layout.
- Incidental anchors without a documented stay-incidental rationale are queued for re-keying; rules out leaving silent incidental pins unclassified.

## Prerequisites

## Primary implementation surface

- `v2/docs/structural-invariant-test-audit.md`

## Acceptance criteria

- [ ] `v2/docs/structural-invariant-test-audit.md` lists every structural-invariant test under `v2/src/**` and `shared/**` and classifies each anchor as behavioral or incidental.
- [ ] Every incidental anchor in the audit is tagged either `re-key` or `stay-incidental` with a one-line rationale when `stay-incidental`.
- [ ] `bun run typecheck` passes.

## Documentation updates

- None — the audit artifact is the durable documentation for this intent.
