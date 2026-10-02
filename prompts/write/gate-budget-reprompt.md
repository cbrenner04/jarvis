---
id: write.gate-budget-reprompt
behavior: write
kind: step
fragmentPolicy: none
revision: 2
placeholders: [SPEC_PATH:string!, STEP_RULES:string!, REFUSED_COMMAND:string!]
---
Read the spec at <SPEC_PATH>.

The previous iteration already admitted two scoped gate runs (`bun run test:*`). The command `<REFUSED_COMMAND>` was refused with cause `iteration_gate_budget`.

Continue the task. Keep scoped gate runs within the per-iteration budget; verify with file-scoped `bun test <file>` where possible.

<STEP_RULES>
