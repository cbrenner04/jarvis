# Require v2 integration evidence at finalization

A v2 implement run can settle completed and flip its PR ready while an explicitly required socket-backed integration test is red. The checked criterion and aggregate ready gate are not sufficient evidence that the sandbox-off slice passed.

## Decisions

- Treat an active linked subspec's acceptance criterion naming `bun run test:integration:v2` as requiring that scope; rules out inferring required scope from checked state or arbitrary prose elsewhere in the subspec.
- Capture required scope while the linked subspec is active and carry it to completion finalization; rules out reparsing an index after Jarvis has checked its terminal link.
- Run the required integration command after the normal ready gate and before `gh pr ready`, classifying non-zero exit as a ready-gate failure eligible for the existing bounded repair path; rules out flipping first or inventing a new terminal outcome.
- Accept only finalization's exit-zero `bun run test:integration:v2` result as evidence for the explicit scope; rules out trusting the aggregate `bun run test` result or acceptance checkbox.
- Preserve `.sandbox-unrunnable.test.ts` routing for irreducible OS/socket coverage; rules out moving those tests into the agent-runnable slice to make completion green.
- Keep explicit integration enforcement scoped to implement subspecs that name it; rules out adding the command to plan, intent, docs-only, or other finalization flows without a caller requirement.

## Work

- Reproduce the bypass with an active implement subspec that explicitly requires `bun run test:integration:v2` and a deterministic red integration result.
- Thread the active subspec's required-integration evidence through linked implement completion into `ready-finalize`.
- Run `bun run test:integration:v2` through the existing subprocess seam after the ready gate; preserve command, exit code, and combined output in `ReadyGateError`.
- Stop before the draft-to-ready flip on required-scope failure and use the existing ready-gate repair and failed-settlement behavior.
- Update `v2/docs/operator-runbook.md` Gate trust and `v2/docs/v1-behaviors.md` with the explicit required-scope contract. Retain the adversarial mutation-review stopgap until `implement-completion-requires-adversarial-mutation-verification` ships.
- Update `v2/docs/test-writing.md` only if reproduction disproves its aggregate-suite contract; otherwise leave its routing documentation unchanged.

## Acceptance criteria

- [x] A v2 implement run whose active subspec requires `bun run test:integration:v2` settles without `runStatus: completed` when that command exits non-zero, and its draft-to-ready operation is not called.
- [x] `v2/src/execution/ready-finalize.test.ts` regression `rejects required v2 integration scope failure before publisher finalization` fails against the reproduced bypass and passes only when finalization requires an exit-zero `bun run test:integration:v2` result.
- [x] The regression verifies ready gate → required integration scope → draft-to-ready ordering and preserves the required command's non-zero exit and output as ready-gate failure evidence.
- [x] Finalization without an active subspec requirement does not invoke `bun run test:integration:v2`; existing `v2/src/execution/ready-finalize.test.ts` ready-gate and flip tests stay green.
- [x] `v2/docs/operator-runbook.md` Gate trust and `v2/docs/v1-behaviors.md` document the required integration evidence, failure settlement, and no-flip behavior; `v2/docs/test-writing.md` matches the reproduced aggregate-suite semantics.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — operator meaning of completed settlement and the retained mutation-review stopgap.
- `v2/docs/v1-behaviors.md` — changed v2 finalization contract.
- `v2/docs/test-writing.md` — only if aggregate-suite diagnosis changes its current contract.
