# Await run-path Git work

Make Git work reached by an in-process daemon run yield to the event loop without changing its observable result.

## Decisions

- Convert every Git subprocess on the in-process run path; rules out converting only commit or review calls.
- Preserve sequential awaits where later Git commands consume earlier results; rules out concurrent dependent commands.
- Keep completion publication and ready finalization outside this change; rules out widening the refactor to push, PR finalization, or their failure policy.
- Prove responsiveness through an unrelated daemon RPC while a representative run-path Git call is pending; rules out unit-testing only the async helper.

## Tasks

- [ ] Replace synchronous Git execution on the daemon-hosted write, workflow, intent-output, attribution, and review-rendering paths with awaited execution, propagating async contracts through their callers.
- [ ] Preserve existing stdout handling, failures, fallback behavior, and command ordering at each converted boundary.
- [ ] Add daemon-hosted coverage that holds representative run-path Git work pending and completes an unrelated IPC request before it resolves.
- [ ] Document the run-path Git yielding boundary in `v2/docs/v2-architecture.md`.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with the asynchronous daemon run-path Git boundary and its responsiveness guarantee.

## Acceptance criteria

- [ ] Daemon-hosted runs await Git work for worktree operations, completion commits, intent output, attribution rendering, and review diff rendering without blocking unrelated IPC.
- [ ] Dependent run-path Git commands retain their existing output, failure, and ordering behavior.
- [ ] An automated daemon IPC test proves a request completes while representative run-path Git work remains pending.
- [ ] `v2/docs/v2-architecture.md` documents asynchronous Git execution on the daemon run path.
