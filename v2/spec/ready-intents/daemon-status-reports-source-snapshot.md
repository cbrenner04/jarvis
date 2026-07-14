---
name: daemon-status-reports-source-snapshot
---

# Daemon status reports the loaded source snapshot

`jarvis daemon status` identifies the source revision loaded by the running daemon and the revision used by the invoking CLI. It labels a mismatch as stale instead of printing only `running` or requiring the operator to compare revisions manually.

## Decisions

- Report both loaded and current revisions with an explicit stale classification; rules out a lone opaque revision or manual comparison.
- Exit non-zero when stale; rules out scripts treating a mismatched daemon as ready.
- Keep the daemon process on its startup snapshot; rules out hot-swapping code under in-flight runs.
- Preserve stopped detection and its non-zero exit; rules out treating a missing daemon as a version mismatch.

## Documentation updates

- `v2/docs/write-behavior.md` — status output and exit contract.
- `v2/docs/daemon-host.md` — daemon source-snapshot lifetime and identity boundary.
- `v2/docs/v1-behaviors.md` — v2-only daemon status behavior.

## Prerequisites
