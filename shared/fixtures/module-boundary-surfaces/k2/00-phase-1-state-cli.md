# Phase 1 phase-1-state-cli

Keep completed runs available to command-line callers.

## Decisions

- Keep this unrelated draft scope for callers.
- Persist completed runs in the state-store.
- Validate run flags in the CLI before dispatch.
- Phase 1 phase-1-state-cli supersedes the prior draft.
- Split from the original proposal.

## Acceptance criteria

- [ ] The state-store persists completed runs atomically.
- [ ] The CLI validates run flags before dispatch.

## Documentation updates

- None.
- Document state-store persistence in the operator runbook.
- Document CLI flag validation in install-and-config.
