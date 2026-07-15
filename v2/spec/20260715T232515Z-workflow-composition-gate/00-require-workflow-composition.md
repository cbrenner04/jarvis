# Require workflow composition

Add the v2 authoring gate that keeps workflow behavior within established composition boundaries.

## Decisions

- Require new workflow behavior to compose existing publication, review, landing, and linked-subspec routing groups; rules out duplicating those groups in preset-specific paths.
- Require an exact `## Blocker` in the active subspec when composition would need a new runner dispatch branch; rules out extending the runner state machine within that implementation.
- Exempt declarative preset-table rows that only compose existing groups; rules out treating configuration growth as new workflow behavior.
- Enforce this as a documented planning and implementation standard; rules out adding runtime or lint machinery for a proposal-time gate.

## Tasks

- Add the composition and Blocker gate to the v2 coding standards.
- Cross-link the governing gate from the workflow runner dispatch boundary.

## Acceptance criteria

- [ ] `v2/docs/coding-standards.md` requires new workflow behavior to compose existing publication, review, landing, and linked-subspec routing groups.
- [ ] `v2/docs/coding-standards.md` requires an active subspec `## Blocker` instead of a new runner dispatch branch, while exempting declarative preset rows that compose existing groups.
- [ ] `v2/docs/workflow-runner.md` cross-links the governing composition standard at the runner dispatch boundary without duplicating it.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md`: add the composition gate, Blocker requirement, and preset-row boundary.
- `v2/docs/workflow-runner.md`: cross-link the standard from runner dispatch ownership.
