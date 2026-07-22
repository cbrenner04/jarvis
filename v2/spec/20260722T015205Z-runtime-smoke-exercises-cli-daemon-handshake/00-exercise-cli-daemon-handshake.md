# Exercise the CLI-daemon handshake

Daemon-owned runtime smoke currently exits through `daemon-entrypoint.ts --help`, so incompatible CLI and daemon code can pass completion without exchanging an IPC request.

## Decisions

- Run production CLI `daemon start`, `daemon status`, and `daemon stop` against one fresh isolated daemon; rules out `--help`, direct daemon launch, and test doubles as handshake evidence.
- Keep the existing CLI-only probe; rules out broadening unrelated CLI smoke behavior.
- Share the runtime-smoke wall-clock deadline across the full handshake; rules out a fresh timeout per command.
- Reap the isolated daemon and local IPC artifacts in unconditional cleanup, including failed start, status, stop, and timeout paths; rules out leaked processes or operator-daemon mutation.
- Return `observed-clean` only when start succeeds, status reports compatible running state, and stop succeeds; rules out partial lifecycle success as clean evidence.
- Use only worktree-local process and IPC resources; rules out network access and the operator daemon's lifecycle paths.

## Task checklist

- Replace the daemon-owned help probe with the bounded production CLI lifecycle handshake.
- Add real-boundary regression coverage for CLI/daemon executable-tree disagreement and cleanup on every outcome.
- Align the durable runtime-smoke and operator documentation.

## Acceptance criteria

- [ ] A daemon-owned run-base production diff executes production CLI start/status/stop against a fresh isolated daemon and returns `observed-clean` only when all three interactions agree.
- [ ] `v2/src/execution/runtime-smoke-verifier.test.ts` creates a real CLI/daemon executable-tree digest mismatch, returns `smoke-failure` instead of `observed-clean`, fails against the pre-fix `--help` probe, and passes after the change.
- [ ] `v2/src/execution/runtime-smoke-verifier.test.ts` proves success, interaction failure, and timeout stay within the runtime-smoke wall-clock bound and leave no spawned daemon running or local IPC artifact behind.
- [ ] The handshake requires no network and does not contact or mutate the operator daemon.
- [ ] Every guard this change adds or modifies is pinned in **both** directions, so inverting any one of them fails a test — **enumerate every changed file before finishing, do not spot-fix one guard**. Cover, specifically: absence-of-effect cases (assert a record/event/key is *not* written, using key-absence rather than an undefined value, since inverting `x === undefined ? {} : {x}` yields a present-but-undefined key); the same guard shape repeated at more than one layer, which needs coverage at each layer independently; and any wall-clock bound (`while (Date.now() < deadline)`), which needs injectable time rather than a real sleep. **Context:** nine implement runs on 2026-07-21/22 stalled `surviving_mutation_failed` on exactly these shapes after satisfying every other criterion with a green gate and green CI. **Add input-validation guards to that list** — a prior attempt (PR #1949) carried this criterion and still stalled on `operator-flip: > → <=` at `v2/src/execution/runtime-smoke-verifier.ts:103`, the `Number.isInteger(value) && value > 0 ? value : null` PID check in `defaultReadPid`. Cover every parsed or read external value in both directions: a well-formed value is accepted, and each rejected form (absent file, unparseable text, zero, negative) returns the null/fallback path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md` § Gate trust, and `v2/docs/v1-behaviors.md` describe the handshake guarantee, shared timeout, unconditional cleanup, and limits without duplicating the authoritative contract.

## Documentation updates

- `v2/docs/write-behavior.md` — authoritative runtime-smoke handshake and result contract.
- `v2/docs/workflow-runner.md` — completion-boundary handshake, timeout, and cleanup semantics; cross-link details.
- `v2/docs/operator-runbook.md` § Gate trust — operator guarantee and limits.
- `v2/docs/v1-behaviors.md` — changed v2 runtime-smoke guarantee.
