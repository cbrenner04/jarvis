# Parity catalog

## Problem

Parity and overhaul docs still describe toggle expansion, missing dispatch, and command-dock work as future.

## Prerequisites

- `01-command-dispatch` ships TUI admission and explicit expansion commands.

## Work

- Record shipped TUI admission and explicit expansion behavior in `v2/docs/v1-behaviors.md`.
- Correct stale command-dock language in `v2/spec/tui-overhaul-brief.md`.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` records TUI pipeline admission and local explicit `expand`/`collapse` commands.
- [ ] `v2/spec/tui-overhaul-brief.md` replaces the `expand`/`collapse` toggle row with explicit expansion/collapse semantics for the selected pipeline or stage node.
- [ ] `v2/spec/tui-overhaul-brief.md` replaces the “parser and admission API have no caller” dispatch gap with command-dock dispatch shipped status while steering commands remain open.

## Documentation updates

- `v2/docs/v1-behaviors.md` — TUI admission and explicit expansion commands.
- `v2/spec/tui-overhaul-brief.md` — explicit expand/collapse semantics and command-dock dispatch shipped; steering open.
