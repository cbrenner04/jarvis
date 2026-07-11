# Permit a second implement preset step

Allow the existing `implement` preset validator to accept its current one-step
write workflow and a two-step workflow, leaving execution behavior unchanged.

## Decisions

- Accept one or two `implement` steps; rules out rejecting the future review slot before its behavior exists.
- Keep both accepted shapes on the current write-step path with existing pinned fields; rules out adding review dispatch or semantics in a cardinality change.
- Keep every non-`implement` preset's exact cardinality; rules out broadening validation globally.

## Tasks

- [ ] Relax only the `implement` preset's step-count validation.
- [ ] Cover accepted one- and two-step `implement` shapes and rejected out-of-range counts.
- [ ] Align the workflow-runner and v1-behavior documentation.

## Documentation updates

- `v2/docs/workflow-runner.md`: state that `implement` permits one or two authored steps and that this change does not add review behavior.
- `v2/docs/v1-behaviors.md`: record the v2 additive implement preset cardinality contract.

## Acceptance criteria

- [ ] `resolveWorkflowPreset("implement", ...)` accepts one and two current write-step inputs, retaining the preset's existing write-step and pinned-field behavior.
- [ ] `resolveWorkflowPreset("implement", ...)` rejects zero and three steps, while every other preset keeps its existing exact-count validation.
- [ ] Workflow preset tests cover both accepted implement counts and rejected implement counts without adding review execution behavior.
- [ ] `v2/docs/workflow-runner.md` documents the implement preset's one-or-two-step limit and `v2/docs/v1-behaviors.md` records the additive v2 behavior.
