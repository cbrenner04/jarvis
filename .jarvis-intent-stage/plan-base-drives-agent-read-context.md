---
name: plan-base-drives-agent-read-context
---

# The resolved base determines what the plan agent reads on both spec homes

`buildPlanWorkflowSteps` derives the plan agent's readable code from the resolved base rather than always `getBaseBranch`. For `specs: repo` the plan worktree checks out the resolved base; for `specs: external` the read-context checkout (`materializeReadCheckout`) archives the resolved base ref's tree into the agent cwd. A prerequisite branch's in-flight code is thereby present to the plan agent, and its `## Prerequisites` check passes on its own merits when the base carries the prerequisite.

The prerequisite check itself is not suppressed or weakened: a plan whose prerequisite is absent from the resolved base must still block. The drafted spec tree is still authored on the plan branch; the base only changes what the agent can read — the plan PR does not retarget or stack onto the prerequisite branch.

## Prerequisites

- plan accepts --base <ref> and threads the resolved base into the plan workflow input

## Documentation updates

- `v2/docs/workflow-runner.md` — plan preset contract: base resolution and its effect on the prerequisite read for `specs: repo` (worktree checkout) and `specs: external` (read-context archive).
- `v2/docs/operator-runbook.md` — § Concurrency: replace the "a dependent plan run costs one dispatch" note with the chained-base practice for a declared-prerequisite chain.
