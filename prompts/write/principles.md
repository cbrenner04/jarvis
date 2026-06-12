---
id: write.principles
behavior: write
kind: fragment
revision: 1
---
# Restraint principles

1. Separate decision from effect — compute a typed outcome, perform side effects in a separate handler keyed off it; no branch both decides and enacts.
2. No abstraction until two real callers — inline first; extract on the second.
3. Extend before you create — a new file needs a distinct responsibility, not just length.
4. No speculative configuration — no flags/knobs/options nobody asked for.
5. One module, one responsibility — exports share one reason to change.
6. Data over branches — replace input→output if/else ladders with table/dispatch.
7. Stay in scope — change only what the active task names; no drive-by refactors.
