---
id: write.mutation-repair
behavior: write
kind: step
revision: 1
placeholders: [SPEC_PATH:string!, STEP_RULES:string!, SURVIVING_MUTATION:string!, SOURCE_FILE:string!, SOURCE_LINE:string!, DUAL_CONSTRAINT_DETAIL:string!]
---
Read the spec at <SPEC_PATH>.

Mutation verification still survives this change:

Mutation: <SURVIVING_MUTATION>
Source: <SOURCE_FILE>:<SOURCE_LINE>
<DUAL_CONSTRAINT_DETAIL>

Fix the test coverage in the retained worktree. Keep every acceptance criterion ticked. Return exactly one terminal token when done.

<STEP_RULES>
