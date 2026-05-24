# Documentation standard

Defines the operational meaning of "Documented in code".

## Inline standard

For code-level documentation:

- Doc-comment every exported symbol.
- State contract: purpose, params, returns, thrown errors, invariants.
- Comment why, not what.
- Do not narrate obvious code.
- A comment must add information the code cannot.

## Placement policy

Document each behavior in exactly one durable home. Cross-link; do not duplicate.

| Concern | Location |
| --- | --- |
| Single symbol contract (purpose, params, returns, errors, invariants) | Inline doc-comment |
| Non-obvious line/block rationale (why, tradeoff, invariant) | Inline comment near code |
| Cross-file architecture and boundaries | `v2/docs/` |
| Component/service contracts spanning files | `v2/docs/` |
| Operator/workflow behavior | `v2/docs/` |
| Design decisions and rationale | `v2/docs/` |
| Work intent and acceptance contract for a specific change | Spec (`v1/spec/` or `v2/spec/`) |
