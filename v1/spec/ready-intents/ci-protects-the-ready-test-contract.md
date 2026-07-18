---
name: ci-protects-the-ready-test-contract
---

# CI protects the ready gate's test contract

## Problem

PR CI runs path-scoped suites while an unscoped local `bun run ready` runs the aggregate suite. Their file rosters and execution policies can drift, allowing green CI to merge a tree whose local gate cannot pass.

## Decisions

- Define the aggregate roster as the union of agent and integration files from `test:v1`, `test:v2`, and `test:shared`; rules out independently maintained commands.
- Map `v1/**` and `v2/**` changes to their agent and integration pairs, `shared/**` to all three pairs, `test/**` to the shared pair, root tooling (`package.json`, `tsconfig*.json`, `.github/**`, `scripts/**`) and unknown paths to the aggregate, and docs/spec-only changes to no test slice.
- Make aggregate and scoped execution use the same per-file timeout, isolation, and failure policy; rules out roster parity with different runner behavior.

## Out of scope

- Changing markdown lint policy.
- Repairing a red gate after publication.
- Partitioning the slow v1 run-command test file.

## Acceptance criteria

- `test/test-slices.test.ts` contains a regression test that fails before the change when the aggregate roster differs from the union of all scoped rosters.
- For every scoped script, its files run under the same policy as those files in the aggregate; a policy-difference regression test fails before the change.
- Root-tooling, shared, and `test/` path classifications select the defined aggregate or scoped roster.
- The durable gate documentation states the deliberate boundary between scoped PR checks and an unscoped local gate.

## Documentation updates

- `v2/docs/operator-runbook.md` — document the protected CI/aggregate contract.
- `v2/docs/v1-behaviors.md` — record CI and ready test-selection semantics.
- `v1/docs/operator-runbook.md` — remove the temporary incident warning.

## Prerequisites
