# Require review evidence

Make reviewed-intent completion prove that its critic ran and produced a verdict artifact; surface review setup and enforcement failures to the operator.

## Prerequisites

- The intent review step invokes its critic with a rendered prompt and produces a verdict artifact.

## Decisions

- A review succeeds only after a critic invocation produces its managed verdict artifact; rules out inferring success from an empty cycle list or nominal step dispatch.
- Empty verdict content is valid evidence when the critic created it; rules out requiring findings or actuator work for success.
- Missing or empty reviewed-intent workspace and exhausted critic bindings fail with a named operator-readable reason; rules out completing or landing unreviewed staged output.
- Boundary inspection errors fail closed and preserve their cause; rules out `getChangedPaths` treating failed Git inspection as an unchanged tree.
- Boundary violations and enforcement failures persist and return an operator-readable message; rules out message-less `failureKind: "error"` outcomes.
- Scope is `intent-reviewed`; rules out changing `plan-reviewed*` before `invalid-token-discards-completed-work` lands.

## Work

- Require critic invocation plus verdict production before reviewed-intent review can complete or land.
- Fail missing/empty workspaces, unavailable critic execution, boundary violations, and boundary-inspection errors with named messages.
- Add focused workflow-runner and enforcement regression coverage.
- Align durable workflow and operator documentation.

## Acceptance criteria

- [ ] An `intent-reviewed` review with no critic invocation or verdict evidence stops as `invocation_failure`, never `completed`, and reports why.
- [ ] A missing or empty reviewed-intent workspace fails before landing with an operator-readable message.
- [ ] Exhausting the configured critic bindings fails the review with an operator-readable message.
- [ ] Empty critic output still counts as a produced verdict and may complete without actuator invocation.
- [ ] Critic or actuator boundary violations fail, restore unauthorized changes, and expose the violation message in the persisted and returned failure.
- [ ] A Git error while inspecting review boundary changes fails enforcement with the underlying cause instead of reporting no changes.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/workflow-runner.md` defines the evidence requirement and named failure cases; `v2/docs/operator-runbook.md` removes the silent-no-op caveat and states the corrected status.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with review evidence and failure semantics.
- Update `v2/docs/operator-runbook.md` to remove the missing-evidence caveat.
