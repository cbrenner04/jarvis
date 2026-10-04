# Execute the light plan-review over the materialized draft

The generic `review` behavior forwards only a verdict to its actuator; it does
not itself supply the draft, intent, or spec guidance. The light plan-review
step must render `plan.prompt.review-actuator` against the freshly materialized
draft and publish the actuator's edits with a durable verdict.

## Decisions

- Render `plan.prompt.review-actuator` against the materialized post-draft state — the built draft spec files, `intent.md`, spec guidance, and the critic verdict — not builder-time metadata — rules out an actuator that runs with no draft to act on.
- Resolve review `cwd` and `<spec-dir>/verdict-plan.md` from the worktree/spec directory produced by the draft step — rules out source-step metadata paths that predate the materialized draft.
- The critic is advisory-only; the actuator is the sole mutator of the spec tree — rules out both roles writing and resolves the read-only ambiguity.
- Publish actuator edits into the same committed/PR'd spec tree the draft produced, alongside the persisted verdict — rules out reviewed output that never lands.

## Task checklist

- [ ] Render `plan.prompt.review-actuator` against the materialized draft spec files, `intent.md`, spec guidance, and the critic's verdict.
- [ ] Resolve review `cwd` and the `<spec-dir>/verdict-plan.md` path from the built worktree/spec directory and persist the verdict there.
- [ ] Publish the actuator's edits into the draft's committed/PR'd spec tree.
- [ ] Enforce the role boundary: the critic performs no writes; the actuator is the sole mutator.
- [ ] Add end-to-end coverage that a positive-pass run publishes actuator edits and persists the verdict at the published spec directory.
- [ ] Document the changed generic review/actuator live-context contract.

## Acceptance criteria

- [x] For a positive-pass light review, `plan.prompt.review-actuator` renders against the materialized post-draft draft, `intent.md`, and spec guidance — not builder-time metadata — and consumes the critic's verdict.
- [x] Review `cwd` and `<spec-dir>/verdict-plan.md` resolve from the worktree/spec directory built by the draft step, and the verdict persists at that published spec directory.
- [x] The critic performs no edits or commits; the actuator is the sole writer of the spec tree.
- [x] A positive-pass run publishes the actuator's edits into the draft's spec tree, and the completion artifact (commit / draft PR) includes both the reviewed spec files and `verdict-plan.md`.
- [x] End-to-end tests prove the composed positive-pass workflow publishes actuator edits and persists the verdict at the published spec directory.
- [x] `v2/docs/write-behavior.md` documents the light step's live-context actuator rendering and verdict-publication contract.

## Documentation updates

- `v2/docs/write-behavior.md`: the changed generic review/actuator live-context rendering and verdict-publication contract.
