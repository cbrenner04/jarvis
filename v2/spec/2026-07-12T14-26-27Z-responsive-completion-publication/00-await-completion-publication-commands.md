# Await completion publication commands

Make daemon-reachable completion publication yield while commands run.

## Decisions

- Await GitHub auth, push, PR ensure, and PR-body refresh commands plus each retry attempt; rules out fire-and-forget publication that lets completion advance before its failure is known.
- Keep auth before publication and push → PR ensure → body refresh in order; rules out concurrent operations that can refresh a nonexistent PR.
- Convert PR-body refresh's GitHub read/write and attribution-rendering paths to awaited execution; rules out leaving any synchronous command inside the refresh boundary.
- Leave ready-gate and draft→ready commands unchanged; rules out widening completion-publication responsiveness into finalization.
- Preserve retry count, backoff, permanent push rejection, output, and failure semantics; rules out treating async conversion as a publication-policy change.

## Tasks

- [ ] Replace daemon-reachable synchronous Git/GitHub execution in completion publication and PR-body refresh, including attribution rendering, with awaited execution, injected seams, and retry operations.
- [ ] Preserve completion publication order and retry/error behavior with focused tests.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with asynchronous daemon completion publication and responsive IPC.
- Update `v2/docs/v1-behaviors.md` with the changed existing completion-publication behavior.

## Acceptance criteria

- [ ] Completion publication awaits GitHub auth, upstream detection, push, HEAD lookup, PR lookup/creation, and every PR-body refresh operation; retry attempts remain awaited.
- [ ] Push, PR ensure, and body refresh remain ordered, and their existing retry and permanent-failure behavior stays covered by `v2/src/execution/completion-publisher.test.ts`, `v2/src/execution/pr-body-refresh.test.ts`, and `v2/src/execution/pr-attribution.test.ts`.
- [ ] `v2/docs/v2-architecture.md` and `v2/docs/v1-behaviors.md` document asynchronous daemon completion publication and its IPC responsiveness guarantee.
