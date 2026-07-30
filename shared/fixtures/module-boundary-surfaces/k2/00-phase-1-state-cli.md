# Phase 1 phase-1-state-cli

Keep completed runs available to command-line callers.

## Decisions

- Keep this unrelated draft scope for callers.
- Phase 1 phase-1-state-cli supersedes the prior draft.
- Split from the original proposal.
- The state-store owns the completed-run persistence contract.
- The command-line entrypoint owns flag validation before dispatch.

## Acceptance criteria

- [ ] The state-store persists completed runs atomically.
- [ ] The CLI validates run flags before dispatch.

## Documentation updates

- Document the state-store persistence API in operator runbook.
- Document CLI flag validation in install-and-config.
- Update the overview when both surfaces ship.
