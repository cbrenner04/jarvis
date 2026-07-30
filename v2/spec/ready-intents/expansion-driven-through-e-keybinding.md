---
name: expansion-driven-through-e-keybinding
---

# Expansion is driven through the real e-keybinding control path

## Problem

No test exercises `toggleSelectedWorkflowExpansion` (`tui-entry.tsx:373-390`) or
the `e` keybinding (`tui-ink-monitor.tsx:79-81`); every expansion test injects
`expandedWorkflowInvocationIds` directly, and the ink test stubs the control as a
no-op (`tui-ink-monitor.test.tsx:109`). The wiring renders but is never proven to
respond.

## Decisions

- Cover expansion through the real control path (`e` keybinding →
  `toggleSelectedWorkflowExpansion` → rendered constituent rows), asserting rows
  appear then disappear on a second press; rules out seeding expansion state and
  the render-without-respond gap this repo has shipped before.
- Coverage asserts rendered rows, not view-model state; a no-op control stub must
  fail the test.

## Prerequisites

- The `e` keybinding invokes `toggleSelectedWorkflowExpansion` on the monitor controls.
- Collapsed workflow rows expand into their constituent member rows in rendered output.
