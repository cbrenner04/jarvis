---
id: write.surviving-mutation-reprompt
behavior: write
kind: step
revision: 1
placeholders: [SPEC_PATH:string!, STEP_RULES:string!, SURVIVING_MUTATION:string!, SOURCE_FILE:string!, SOURCE_LINE:string!, DUAL_CONSTRAINT_DETAIL:string!]
---
Read the spec at <SPEC_PATH>.

Mutation verification found an uncovered changed guard:

Mutation: <SURVIVING_MUTATION>
Source: <SOURCE_FILE>:<SOURCE_LINE>
<DUAL_CONSTRAINT_DETAIL>

Fix the surviving mutation before returning done. Either add or extend a co-located killing test that fails when this guard is inverted, or (only when the change is provably behavior-neutral) place an exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive on the mutated physical line.

<STEP_RULES>
