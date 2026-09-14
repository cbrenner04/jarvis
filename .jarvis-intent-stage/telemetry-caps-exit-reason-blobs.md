---
name: telemetry-caps-exit-reason-blobs
---

# Telemetry rows cap `exit_reason` and `warnings`

`~/.jarvis/telemetry.jsonl` reached 330 MB; 320 MB was `exit_reason` from cursor `quota` exits embedding the full streamed transcript (rows up to 19 MB). Telemetry is the facts ledger; blobs belong in the session log.

## Decisions

- Cap `exit_reason` and `warnings` at write time (a few KB), tail-truncated with a marker.
- Full text stays in the session log, joined by `run_id`/`attempt_id`.

## Acceptance criteria

- [ ] A telemetry row whose `exit_reason` exceeds the cap is persisted truncated with a marker and the untruncated text is present in the invocation's session log; pinned by tests.
- [ ] Oversized `warnings` are capped the same way; pinned by a test.

## Documentation updates

- `v2/docs/telemetry-capture.md` — field caps and where the full text lives.
- `v2/docs/v1-behaviors.md` — record the cap.

## Prerequisites

- Session logs default to `join(jarvisHome(), "sessions")`, so tests exercising session-log content stay isolated from the real home.
