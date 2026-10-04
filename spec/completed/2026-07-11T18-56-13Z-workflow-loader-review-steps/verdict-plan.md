- Require `01` to route one mixed write/review source list through exactly one loader call, then resolve presets from the loaded write steps only; rules out passing review steps to write-only preset resolution or separately loading roles.

- Require the reviewed builder to forward its machine config path, profile, and machines directory to that loader call; rules out silently falling back to default machine configuration.

- Require loader profile selection to preserve `resolveMachineProfile(machineConfigPath)` behavior; rules out changing config-path profile semantics.

- Define and document the discriminated source and loaded step unions, including review’s fixed critic/actuator role record and absence of a write `role`; rules out write-only caller assumptions.

- Require review-load success coverage with multiple configured agents and failure coverage aggregating both roles across agents; rules out validating only a partial loaded order.

- Pin reviewed-intent preservation with tests for its prompt, verdict/staging paths, deferred output, and binding creation; rules out composition drift hidden by merely asserting two returned steps.

- Decide, document, and test whether loader failures retain existing `intent:` error context or expose loader text; rules out accidental operator-facing error changes.

- Require an injected-loader assertion that reviewed intent makes one call containing both write and review source steps; rules out an equivalent-looking result produced by separate pipelines.

- Update `v2/docs/workflow-runner.md` to state that reviewed-builder load failures return `{ ok: false; error }`; rules out documentation contradicting the required caller-facing behavior.

- Add `v2/docs/v1-behaviors.md` to `01`’s required documentation updates; rules out leaving the changed existing builder pipeline absent from the parity catalog.
