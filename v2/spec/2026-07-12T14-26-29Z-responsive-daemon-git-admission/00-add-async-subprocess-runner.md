# Add the shared asynchronous subprocess runner

Expose a non-blocking subprocess seam for daemon consumers without changing v1's synchronous callers.

## Decisions

- Add an asynchronous shared runner alongside `SubprocessRunner`; rules out changing the synchronous interface used by v1 callers.
- Preserve the synchronous runner's UTF-8 stdout and non-zero-exit behavior; rules out a daemon-only subprocess contract.

## Tasks

- [ ] Add an injectable asynchronous subprocess runner and its real implementation under `shared/`.
- [ ] Cover successful output and command failure at the shared seam while retaining synchronous-runner callers unchanged.

## Documentation updates

- No durable documentation update is required: this additive internal seam has no operator or cross-component behavior until a daemon consumer adopts it.

## Acceptance criteria

- [ ] `shared/subprocess.test.ts` proves the asynchronous runner returns UTF-8 stdout and rejects command failures.
- [ ] `v1/test/modes/plan/boundary.test.ts` stays green for synchronous `SubprocessRunner` callers.
