# Prove IPC responsiveness during completion publication

Prove a pending completion-publication command does not block unrelated daemon IPC.

## Decisions

- Hold a real asynchronous completion-publication command seam after it signals pending, then release it only after an unrelated RPC resolves; rules out a timing race or a publisher-stub-only test that cannot prove event-loop yielding.
- Exercise the daemon-hosted IPC path; rules out helper-level async tests as proof of daemon responsiveness.
- Use a non-finalization publication command; rules out extending this proof to ready-gate or draft→ready behavior.

## Tasks

- [ ] Add a daemon-hosted IPC test that blocks a signaled completion-publication command, completes an unrelated RPC, releases the command, and completes the run.

## Documentation updates

- No documentation updates: this test verifies the documented publication behavior from `00-await-completion-publication-commands.md`.

## Acceptance criteria

- [ ] An automated daemon IPC test proves an unrelated RPC resolves after a completion-publication command is pending and before that command is released.
