---
name: tui-state-colors
---

# Color TUI run state cells

Render status and liveness as distinct Ink `Text` cells colored by active, successful-terminal, and failed-terminal semantics. Keep all state text visible so color is not the only signal.

## Decisions

- Color only status and liveness cells; rejected coloring whole rows, which obscures selection and table structure.
- Preserve textual labels alongside color; rejected color-only state signaling.
- Deferred to first consumer: exact Ink palette — pin when a caller needs it.

Update `v2/docs/first-workflow-walkthrough.md` with the semantic color treatment.

## Prerequisites
