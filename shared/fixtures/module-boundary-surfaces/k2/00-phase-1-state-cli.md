# Phase 1 phase-1-state-cli

Keep completed runs available to command-line callers.

## Decisions

- Keep this unrelated draft scope for callers.
- Persist completed runs in the state-store atomically.
- Validate CLI flags before dispatch.
- Phase 1 phase-1-state-cli supersedes the prior draft.
- Split from the original proposal.

## Acceptance criteria

- [ ] The state-store persists completed runs atomically.
- [ ] The CLI validates run flags before dispatch.

## Documentation updates

- Document state-store persistence guarantees in the operator runbook.
- Document CLI flag validation in install-and-config.
- None.
