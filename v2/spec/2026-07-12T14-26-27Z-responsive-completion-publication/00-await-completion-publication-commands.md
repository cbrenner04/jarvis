# Await completion publication commands

Make daemon-reachable completion publication yield while commands run.

## Decisions

- Await every publication command and retry attempt; rules out fire-and-forget publication that advances before its failure is known.
- Run publication commands in auth → upstream detection → push → HEAD lookup → PR lookup/create → body refresh order; rules out concurrent phases that race PR creation or refresh.
- Await PR-body GitHub reads/writes and attribution Git reads; rules out a synchronous refresh boundary.
- Preserve attribution Git-read failure behavior: only intentional no-attribution input yields an empty footer; rules out swallowing rejected reads as an empty footer.
- Leave ready-gate and draft→ready commands unchanged; rules out widening completion-publication responsiveness into finalization.
- Preserve retry count, backoff, retry notices, terminal propagation, and non-fast-forward no-retry behavior; rules out changing publication policy during async conversion.

## Tasks

- [ ] Replace daemon-reachable synchronous Git/GitHub execution in completion publication and PR-body refresh, including attribution rendering, with awaited injected seams and retry operations.
- [ ] Cover sequential publication, retry count/backoff/notices, terminal propagation, non-fast-forward no-retry, and rejected attribution Git reads through async seams.

## Documentation updates

- Update `v2/docs/write-behavior.md` as the durable owner of asynchronous completion publication, ordering, retries, and failures.
- Cross-link IPC responsiveness from `v2/docs/v2-architecture.md`.
- Update `v2/docs/v1-behaviors.md` as the v2 parity/catalog record of the changed behavior.

## Acceptance criteria

- [ ] Completion publication awaits auth, upstream detection, push, HEAD lookup, PR lookup/create, and body refresh in that order; every retry attempt is awaited.
- [ ] Async-seam tests in `v2/src/execution/completion-publisher.test.ts`, `v2/src/execution/pr-body-refresh.test.ts`, and `v2/src/execution/pr-attribution.test.ts` preserve retry count, flat backoff, retry notices, terminal propagation, and non-fast-forward push no-retry behavior.
- [ ] A rejected async attribution Git-read seam fails refresh; only intentional missing attribution input produces an empty footer.
- [ ] `v2/docs/write-behavior.md` owns asynchronous publication ordering, retries, and failures; `v2/docs/v2-architecture.md` cross-links the IPC responsiveness guarantee; `v2/docs/v1-behaviors.md` records v2 parity/catalog behavior.
