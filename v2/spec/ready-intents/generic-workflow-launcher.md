---
name: generic-workflow-launcher
---

# Generic workflow launcher

Replace the `implement`-specific CLI dispatch with a preset registry so `jarvis run workflow <name> [flags]` resolves a builder and starts the daemon with its steps.

## Behavior

- Register `implement` as the only initial preset without changing its flags, builder behavior, daemon request, output, or errors.
- Reject a missing or unknown preset with workflow usage and exit `1` before daemon contact.
- Surface builder failures unchanged before daemon contact.
- Cover known-preset dispatch, unknown-preset rejection, and builder-error handling in co-located CLI tests.

## Decisions

- Keep builders in separate modules; rule out embedding preset construction in the registry — the registry owns name-to-builder wiring only.
- Ship only the `implement` registration; rule out adding `intent` or `plan` before their builders exist.

## Prerequisites

- The workflow runner can dispatch `review` steps.

## Out of scope

- `intent` and `plan` builders or presets.
- Daemon auto-start.
- Project review defaults (`reviewPasses` or `reviewBehavior`).

## Documentation updates

- Update `v2/docs/write-behavior.md` with the generic workflow-launch contract.
- Update `v2/docs/onboarding.md` only if its v2 readiness description becomes false.
