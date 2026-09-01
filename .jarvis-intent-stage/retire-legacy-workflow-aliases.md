---
name: retire-legacy-workflow-aliases
---

# Retire legacy `run workflow` aliases

## Prerequisites

## Problem

The hidden aliases `intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light` (`workflow-args.ts`) print deprecation warnings, are absent from the help tree, and the reviewed-plan alias path is known-broken (false `killed`, stranded spec). Operator guidance is plain `plan` / `intent` with review flags.

## Behavior

`run workflow intent-reviewed`, `run workflow plan-reviewed`, and `run workflow plan-reviewed-light` resolve to unknown-workflow errors at CLI admission. Remove `LEGACY_WORKFLOW_ALIASES`, alias resolution, deprecation stderr, and related types from workflow CLI admission (`workflow.ts`, `workflow-args.ts`).

## Decision ledger

- Delete aliases without a sunset window; rules out keeping deprecation plumbing for a single-operator repo with no external consumers.
- Resolve alias strings as unknown workflows at CLI admission; rules out silently forwarding to canonical names with injected review flags.

## Acceptance criteria

- [ ] `workflow.test.ts` pins `intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light` as unknown workflows with no deprecation stderr; the cases fail against the pre-fix alias forwarding.
- [ ] No `LEGACY_WORKFLOW_ALIASES` symbol or deprecation helper remains in workflow CLI admission code.
- [ ] Canonical `run workflow intent`, `plan`, and `implement` admission tests stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record that legacy reviewed alias strings are rejected at CLI admission.
