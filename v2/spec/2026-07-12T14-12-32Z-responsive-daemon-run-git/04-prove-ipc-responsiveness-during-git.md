# Prove IPC responsiveness during Git

Prove that awaited run-path Git leaves the daemon event loop available.

## Decisions

- Signal a pending representative run-path Git operation before issuing the unrelated RPC, then release Git only after that RPC completes; rules out a timing race that cannot prove event-loop yielding.
- Use a new daemon-hosted IPC test; rules out treating helper-level async tests as proof of daemon responsiveness.

## Tasks

- [ ] Add a daemon-hosted test that holds a representative run-path Git operation at a signaled pending state, completes an unrelated RPC, then releases Git and completes the run.
- [ ] Document the daemon run-path Git yielding guarantee in the durable architecture and existing-behavior catalog.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with asynchronous Git execution on daemon-hosted run paths and the unrelated-IPC responsiveness guarantee.
- Update `v2/docs/v1-behaviors.md` with the changed existing daemon-run behavior.

## Acceptance criteria

- [ ] An automated daemon IPC test proves an unrelated request completes after representative run-path Git signals pending and before that Git operation is released.
- [ ] `v2/docs/v2-architecture.md` documents asynchronous Git execution on daemon-hosted run paths and the responsiveness guarantee.
- [ ] `v2/docs/v1-behaviors.md` records the changed existing daemon-run behavior.
