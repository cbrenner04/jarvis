---
name: runtime-smoke-exercises-cli-daemon-handshake
---

# Runtime smoke exercises the CLI-daemon handshake

Replace daemon `--help` smoke with a real CLI interaction against a fresh daemon so component disagreement fails completion verification.

## Decisions

- Exercise CLI start, status, and stop against a freshly started daemon; rules out process-start or help-output checks as interaction evidence.
- Run the production CLI and daemon boundary; rules out replacing the smoke with unit tests or doubles.
- Bound the full handshake and clean up its daemon on success, failure, or timeout; rules out open-ended probes and leaked processes.
- Use only local process and IPC resources; rules out network-dependent completion.

## Acceptance criteria

- An implicated daemon surface runs a real CLI start/status/stop handshake and reports `observed-clean` only when every interaction agrees.
- `runtime-smoke-verifier.test.ts` reproduces a CLI/daemon executable-tree digest mismatch during the handshake; it returns `smoke-failure` rather than `observed-clean`, fails against the current `--help` verifier, and passes after the change.
- The handshake stays within the runtime-smoke wall-clock bound, requires no network, and leaves no daemon running.
- `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — the interaction smoke guarantee and its limits.
- `v2/docs/workflow-runner.md` — CLI-daemon handshake, timeout, and cleanup semantics.
- `v2/docs/v1-behaviors.md` — record the changed v2 runtime-smoke guarantee.

## Prerequisites

- Production diffs map loaded daemon and CLI code to their implicated runnable surfaces.
