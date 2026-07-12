---
name: help-overview-orientation
---

# Top-level help orients instead of dumping flag signatures

`jarvis1 help` currently prints every command's full flag signature inline — unreadable, and
it still doesn't say what jarvis does or how the commands relate.

- Overview opens with one line on what jarvis is (spec-driven coding-agent harness).
- Commands are listed by name + one-line summary only; no flag signatures in the overview.
- Commands are grouped by the operator lifecycle (author a spec → implement → finalize →
  maintain), so a new-day operator can find the next command.
- Footer points at `jarvis1 <command> --help` for flags.
- Unknown command still prints the overview, and the overview stays short enough to read in
  one screen.

Changes existing behavior: update `v2/docs/v1-behaviors.md`.

## Prerequisites
