# Prove IPC responsiveness during completion publication

Prove a pending completion-publication command does not block unrelated daemon IPC.

## Decisions

- Hold an injected production publication command after it signals pending, then release it only after `list` resolves; rules out a timing race or a whole-publisher stub that cannot prove event-loop yielding.
- Exercise `startIpcServer` through connected Unix-socket clients; rules out helper-level tests or in-process dispatch as proof of daemon responsiveness.
- Use a non-finalization publication command; rules out extending this proof to ready-gate or draft→ready behavior.

## Tasks

- [ ] Add a production-transport IPC test that holds a signaled injected publication command, resolves `list` from another Unix-socket client, releases the command, and completes publication.

## Documentation updates

- No documentation updates: this test verifies the documented publication behavior from `00-await-completion-publication-commands.md`.

## Acceptance criteria

- [ ] An automated `startIpcServer` test with connected Unix-socket clients proves `list` resolves after an injected publication command is pending and before it is released, then completes publication.
