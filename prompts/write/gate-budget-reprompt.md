---
id: write.gate-budget-reprompt
behavior: write
kind: step
fragmentPolicy: none
revision: 1
placeholders: [REFUSED_COMMAND:string!]
---
This iteration already admitted two scoped gate runs (`bun run test:*`). The command `<REFUSED_COMMAND>` was refused with cause `iteration_gate_budget`.

Do not run `bun run test:*` again this iteration. Verify with file-scoped `bun test <file>` instead.

Return exactly one terminal token when done.
