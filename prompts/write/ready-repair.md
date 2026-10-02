---
id: write.ready-repair
behavior: write
kind: step
fragmentPolicy: global
revision: 3
placeholders: [SPEC_PATH:string!, STEP_RULES:string!, GATE_COMMAND:string!, GATE_STEP:string!, GATE_EXIT_CODE:string!, GATE_OUTPUT:string!, ALLOWED_PATHS:string!]
---
Read the spec at <SPEC_PATH>.

The ready gate failed:

Command: <GATE_COMMAND>
Failing step: <GATE_STEP>
Exit code: <GATE_EXIT_CODE>
Output of the failing step:
<GATE_OUTPUT>

## Allowed paths

<ALLOWED_PATHS>

Edits outside these paths are reverted and end the run.

Fix the failure in the worktree. Return exactly one terminal token when done.

<STEP_RULES>
