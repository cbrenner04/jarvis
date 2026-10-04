# 00 - Guard daemon stop

## Problem

`jarvis daemon stop` shuts down the daemon while durable runs remain non-terminal, destroying in-flight work without warning.

## Decisions

- Normal stop inspects durable rows, including queued and temporarily non-live work; rules out guarding only in-memory loops or IPC liveness.
- `completed`, `failed`, `blocked`, and `killed` are non-blocking; every other durable status blocks normal stop, which rules out reusing the narrower boundary-terminal classification that excludes `killed`.
- Refusal performs no shutdown request, process signal, or PID-file cleanup; rules out detecting blockers after destructive shutdown has begun.
- Durable-state inspection failure refuses normal stop; rules out treating an unreadable store as no blockers.
- `--force` bypasses only this guard and uses the existing shutdown path; rules out prompting, killing runs individually, or adding recovery behavior.

## Scope

- Guard the daemon lifecycle stop path with the durable run set and expose all blocker IDs to the CLI.
- Parse only `jarvis daemon stop` and `jarvis daemon stop --force`; retain usage failure for other arguments.
- Keep forced-stop drain, signal fallback, timeout, and PID cleanup semantics unchanged.

## Out of scope

- Forced stop does not restart or resume runs; rules out recovery orchestration in the stop command.
- Daemon restart after merging v2 changes remains operator-owned; rules out hot reload or automatic restart work.

## Acceptance criteria

- [x] A regression test in `v2/src/daemon/daemon-lifecycle.test.ts` seeds durable queued, live, paused, and temporarily non-live non-terminal rows, then proves normal stop reports every run ID and performs no shutdown or process termination; it fails against the pre-fix code.
- [x] Durable `completed`, `failed`, `blocked`, and `killed` rows do not block normal stop, while failure to inspect durable state refuses it without shutdown side effects.
- [x] `v2/src/cli.test.ts` proves a refused `jarvis daemon stop` exits non-zero, writes every blocker ID to stderr, and does not print `stopped`.
- [x] `v2/src/cli.test.ts` proves `jarvis daemon stop --force` bypasses the guard, executes the existing stop path, prints `stopped`, and exits `0`; unsupported stop arguments print usage and exit non-zero.
- [x] `bun run typecheck` and `bun run test:v2` pass.
- [x] `v2/docs/daemon-host.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md` describe the guarded stop semantics and force bypass in their durable homes.

## Documentation updates

- `v2/docs/daemon-host.md` — authoritative lifecycle contract: durable blocker statuses, refusal side effects, inspection failure, and force bypass.
- `v2/docs/write-behavior.md` — `stop [--force]` syntax, output, and exit behavior; link to the host contract instead of duplicating it.
- `v2/docs/v1-behaviors.md` — record the changed v2 daemon-stop behavior for parity review.
