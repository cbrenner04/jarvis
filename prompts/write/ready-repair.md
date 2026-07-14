---
id: write.ready-repair
behavior: write
kind: step
revision: 1
placeholders: [SPEC_PATH:string!, STEP_RULES:string!, GATE_COMMAND:string!, GATE_EXIT_CODE:string!, GATE_OUTPUT:string!]
---
Read the spec at <SPEC_PATH>.

The ready gate failed:

Command: <GATE_COMMAND>
Exit code: <GATE_EXIT_CODE>
Output:
<GATE_OUTPUT>

Fix the failure in the worktree. Return exactly one terminal token when done.

<STEP_RULES>
