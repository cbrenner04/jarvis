---
name: workflow-composition-gate
---

# Require workflow behavior to compose existing step groups

Add the v2 coding-standard gate that new workflow behavior composes existing publication, review, landing, and routing groups. A proposal needing a new runner dispatch branch must record a spec Blocker instead of adding the branch directly.

## Decisions

- Require a spec Blocker for a new runner dispatch branch; rules out silently extending the runner state machine.
- Apply the gate to workflow behavior, not new preset table rows; rules out blocking composition through declarative configuration.

## Documentation updates

- `v2/docs/coding-standards.md` — composition gate and Blocker requirement.
- `v2/docs/workflow-runner.md` — cross-link the governing standard from the runner boundary.

## Prerequisites

- Publication, review, landing, and linked-subspec routing are available as composable workflow groups.
