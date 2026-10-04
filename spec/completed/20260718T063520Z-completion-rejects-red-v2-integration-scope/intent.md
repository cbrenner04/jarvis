---
name: completion-rejects-red-v2-integration-scope
---

# Completion rejects a red v2 integration scope

## Problem

A v2 implement run reported `runStatus: completed` while a socket-backed
`*.sandbox-unrunnable.test.ts` file named by the active subspec's
`test:integration:v2` acceptance scope was deterministically red sandbox-off.
The checked criterion and green ready gate therefore overstated executed coverage.

Current code and `v2/docs/test-writing.md` claim the aggregate `bun run test` includes
the integration slice, so reproduce the bypass before closing it at finalization.

## Behavior

When an active v2 subspec requires `test:integration:v2`, an exit-zero
`bun run test:integration:v2` result from finalization is required before completed
settlement. A red file in that sandbox-off scope fails closed and prevents the publisher
from attempting its draft-to-ready transition.

## Decisions

- Enforce at the `ready-finalize` boundary: it must run `bun run test:integration:v2` when the active subspec requires that scope, and accept only its exit-zero result as required-scope evidence; rules out trusting a checked acceptance criterion or aggregate-gate result as evidence.
- Preserve `.sandbox-unrunnable.test.ts` routing for irreducible OS/socket coverage; rules out moving these tests into the sandbox-agent slice to make the gate appear complete.

## Documentation updates

- Update `v2/docs/operator-runbook.md` § Gate trust with the reproduced gap and closing enforcement.
- Align `v2/docs/test-writing.md` only if the diagnosed aggregate-suite semantics differ from its current contract.
- Update `v2/docs/v1-behaviors.md` with the changed v2 finalization contract.
- Retain the mutation-review stopgap until `implement-completion-requires-adversarial-mutation-verification` also ships.

## Acceptance criteria

- [ ] A deliberately red socket-backed v2 integration file makes the implement run settle without `runStatus: completed` and leaves the publisher's draft-to-ready operation uncalled when the active subspec requires `test:integration:v2`.
- [ ] `v2/src/execution/ready-finalize.test.ts` regression `rejects required v2 integration scope failure before publisher finalization` fails against the reproduced bypass and passes only after finalization requires the exit-zero `bun run test:integration:v2` result.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Prerequisites

- V2 implement completion runs a full ready gate before ready flip and completed settlement.
- V2 `*.sandbox-unrunnable.test.ts` files are routed to `test:integration:v2` for sandbox-off execution.
