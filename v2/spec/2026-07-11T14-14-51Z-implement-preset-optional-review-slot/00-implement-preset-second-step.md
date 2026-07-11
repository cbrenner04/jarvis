# Permit a second implement preset step

Allow the existing `implement` preset validator to accept one or two write
steps, leaving execution behavior unchanged.

## Decisions

- Accept one or two `implement` steps; rules out rejecting the future review slot before its behavior exists.
- Pin each accepted `implement` position to `behavior: "write"`, `role: "implement"`, and `promptId: "patch.prompt.body"`; rules out assigning review behavior to the added position.
- Define other presets as resolver-supported `write-write`, `intent`, and `plan`, excluding public CLI-only `intent-reviewed`; rules out expanding resolver validation to a non-resolver preset.
- Keep each other resolver-supported preset's exact cardinality; rules out broadening validation globally.

## Tasks

- [ ] Relax only the `implement` preset's step-count validation.
- [ ] Cover accepted one- and two-step `implement` shapes, rejected out-of-range counts, and every other resolver-supported preset's exact cardinality.
- [ ] Align the workflow-runner and v1-behavior documentation.

## Documentation updates

- `v2/docs/workflow-runner.md`: state that `implement` permits one or two authored write steps, pins both positions to its existing role and prompt, and does not add review behavior.
- `v2/docs/v1-behaviors.md`: record the v2 additive implement preset cardinality contract.

## Acceptance criteria

- [ ] `resolveWorkflowPreset("implement", ...)` accepts one and two inputs; every returned position is a `write` step pinned to `role: "implement"` and `promptId: "patch.prompt.body"`.
- [ ] `resolveWorkflowPreset("implement", ...)` rejects zero and three inputs; resolver-supported `write-write`, `intent`, and `plan` retain their exact cardinalities.
- [ ] Workflow preset tests cover both accepted and rejected `implement` counts plus the exact cardinality of every other resolver-supported preset, without review execution behavior.
- [ ] `v2/docs/workflow-runner.md` documents the implement preset's one-or-two-step limit and `v2/docs/v1-behaviors.md` records the additive v2 behavior.
