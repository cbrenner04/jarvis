# Add the shared asynchronous subprocess runner

Expose a non-blocking subprocess seam for daemon consumers without changing v1's synchronous callers.

## Decisions

- Add an asynchronous shared runner alongside `SubprocessRunner`; rules out changing the synchronous interface used by v1 callers.
- Preserve UTF-8 stdout, rejection, and command-result predicate behavior across both runners; rules out a daemon-only subprocess contract.

## Tasks

- [ ] Add an injectable asynchronous subprocess runner and real implementation under `shared/`.
- [ ] Cover UTF-8 output, command rejection, and existing predicate outcomes at the shared seam while retaining synchronous-runner callers unchanged.

## Documentation updates

- No durable documentation update is required: this additive internal seam has no operator or cross-component behavior until a daemon consumer adopts it.

## Acceptance criteria

- [x] `shared/subprocess.test.ts` proves the asynchronous runner returns UTF-8 stdout and preserves the synchronous runner's rejection and predicate behavior.
- [x] `v1/test/modes/plan/boundary.test.ts` stays green for synchronous `SubprocessRunner` callers.
