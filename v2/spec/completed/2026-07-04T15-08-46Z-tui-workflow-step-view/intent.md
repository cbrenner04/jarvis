---
name: tui-workflow-step-view
---

# TUI shows workflow/step view of a running run

The TUI monitor gains a workflow/step view: for a run backed by a multi-step
workflow, the operator sees which step is active, prior steps' outcomes, and
per-step attempt counts, sourced from the daemon over the existing IPC
surface (extended with per-step status).

Decisions:
- Single-step runs keep the existing monitor view unchanged; the step view only activates for workflow-backed runs.

## Prerequisites

- A workflow runner executes a linear array of role-bound steps
- Durable state records per-step attempt history
