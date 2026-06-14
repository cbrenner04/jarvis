# Daemon host, IPC, and structured logging

Phase 3 of v2: add a long-running daemon host over the existing write loop, a
local IPC API, a structured log stream, and CLI controls. Source of truth:
`v2/spec/v2-meta-index.md`, `v2/docs/v2-build-order.md`, and
`v2/docs/v2-architecture.md` (Interface, Runs/state, Persistence, Recovery,
Steering, Git/worktrees).

- [x] [00 - Daemon lifecycle and IPC](./00-daemon-lifecycle-and-ipc.md)
- [x] [01 - Structured per-run logs](./01-structured-per-run-logs.md)
- [x] [02 - Detached write runs](./02-detached-write-runs.md)
- [x] [03 - Steering and cancellation](./03-steering-and-cancellation.md)
