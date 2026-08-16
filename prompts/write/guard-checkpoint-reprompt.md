---
id: write.guard-checkpoint-reprompt
behavior: write
kind: step
revision: 1
placeholders: [ACTIVE_SUBSPEC_PATH:string!, REPAIR_LIST:string!, STEP_RULES:string!]
---
The active subspec's guard checkpoint evidence is repairable.

Active subspec: <ACTIVE_SUBSPEC_PATH>

Repair every checkpoint below as instructed:

<REPAIR_LIST>

Edit the named pinning tests and their directives as needed. Keep every acceptance criterion ticked. Return exactly one terminal token when done.

<STEP_RULES>
