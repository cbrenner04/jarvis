---
name: workflow-presets-authoring-helper
---

# Named workflow presets via an authoring helper

A workflow-authoring helper lets source define a step list (behavior, prompt,
role) without hand-rolling the runner's step shape; named presets (e.g. a
two-step write→write workflow) are built with it and resolvable by name to a
concrete step sequence.

Decisions:
- Helper and presets ship together — the presets defined in this slice are the helper's only caller (deferred generalization until a second caller needs it).
- Preset step lists are static source, not config — role→model bindings still come from the global data file, agent order still from project config.

## Prerequisites

- A workflow runner executes a linear array of role-bound steps
