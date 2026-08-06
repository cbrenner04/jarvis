---
id: write.mutation-directive-reprompt
behavior: write
kind: step
revision: 1
placeholders: [ACTIVE_SUBSPEC_PATH:string!, DIRECTIVE_LIST:string!, STEP_RULES:string!]
---
Mutation-checkpoint directives in the active subspec's pinning tests do not match landed source.

Active subspec: <ACTIVE_SUBSPEC_PATH>

Retarget each `// @mutate` directive so the quoted original occurs exactly once in the named file:

<DIRECTIVE_LIST>

Edit only pinning-test directives (not production code). Keep every acceptance criterion ticked. Return exactly one terminal token when done.

<STEP_RULES>
