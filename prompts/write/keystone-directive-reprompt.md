---
id: write.keystone-directive-reprompt
behavior: write
kind: step
revision: 1
placeholders: [ACTIVE_SUBSPEC_PATH:string!, CRITERION:string!, PIN_PATH:string!, STEP_RULES:string!]
---
The ticked keystone criterion below resolved its pinning test but links no `// @mutate` directive.

Active subspec: <ACTIVE_SUBSPEC_PATH>

Criterion: <CRITERION>

Resolved pin: <PIN_PATH>

Add a `// @mutate` directive inside that pin's test body reverting the headline change, so a revert turns the pin red. Keep every acceptance criterion ticked. Return exactly one terminal token when done.

<STEP_RULES>
