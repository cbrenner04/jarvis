---
name: write-write-workflow-integration
---

# Run a two-step write→write workflow end to end

A named two-step write→write preset runs through the workflow runner with
real role→model resolution and project agent fallback: step one's write
loop completes, the runner advances to step two, step two's write loop
completes, and durable state shows both steps' attempt history.

Decisions:
- This is the phase's end-to-end proof, not new runner/resolution logic — it exercises the prior slices together.

## Prerequisites

- A workflow runner executes a linear array of role-bound steps
- A workflow step's role resolves to a flat agent/model binding list
- A named workflow preset resolves to a concrete step sequence
- A workflow load validates step roles against the loaded config
