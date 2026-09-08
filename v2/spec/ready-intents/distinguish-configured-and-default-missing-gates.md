---
name: distinguish-configured-and-default-missing-gates
---

# Distinguish Configured and Default Missing Gates

## Module-boundary surface

Daemon operator-error composition.

## Problem

`ready_gate_command_missing` always reports `nextAction: fix_config`, even when the missing command came from the built-in default and the project's configuration is already correct.

## Behavior

Expose the executed command and its configured-versus-default source in operator-facing missing-gate evidence. A configured-source miss reports `fix_config`; a default-source miss reports `stop` as a harness-resolution failure.

## Prerequisites

- Workflow admission stamps configured `readyCommand` and `fixCommand` onto write, review, and review-debate steps while leaving absent overrides unstamped.
- Workflow snapshot persistence round-trips review and review-debate gate commands and exposes the dispatch-time values to continuation.
- Fresh and resumed review finalization execute the gate-owning step's resolved commands and record configured-versus-default source evidence for missing commands.

## Decisions

- Operator-error composition consumes explicit command-source evidence; rules out guessing source from the normalized command string.
- `nextAction: fix_config` is reserved for configured-source misses, while default-source misses use `stop`; rules out directing operators to edit already-correct project config.

## Acceptance criteria

- [ ] A daemon settlement regression proves configured-source `ready_gate_command_missing` evidence names the command and source and reports `nextAction: fix_config`.
- [ ] A sibling regression proves default-source evidence names `bun run ready` and the built-in source and reports `nextAction: stop`; it fails against the pre-fix unconditional `fix_config` mapping.
- [ ] Pipeline and run list/wait projections preserve the source-aware operator error without changing configured-command remediation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document the command-source evidence and the configured `fix_config` versus built-in `stop` remediation split.
- `v2/docs/v1-behaviors.md` — update the v2 parity entry for source-aware missing-gate remediation.
