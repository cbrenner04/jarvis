---
name: operator-error-surface
---

# Operator-facing error surface

Expose run errors through CLI/API status surfaces as terse, actionable records: run ID, status, stable error reason, retryability, and next operator action. The operator should not inspect raw logs to decide whether to resume, fix config, rerun, or stop.

## Scope

- Add error detail to run status/list responses.
- Render the same detail in the thin CLI.
- Distinguish resumable stops, human-needed blocks, config/setup failures, quota exhaustion, and harness failures.
- Keep raw stderr/transcripts out of default output.

## Out of scope

- TUI layout.
- Notifications.
- Changing failure classification at source.
- Automatic remediation.

## Decisions

- Status/list carries structured error detail, not prose-only messages — rules out each client re-parsing text.
- Default CLI output is actionable summary only — rules out dumping transcripts unless a future explicit detail command asks for them.
- Retryability is explicit data — rules out clients inferring it from status strings.
- Deferred to first consumer: exact CLI wording and flags — pin when command names are stable.

## Documentation updates

- Operator-facing v2 CLI/API doc home — document error fields and action semantics once that durable home exists.
- `v2/docs/daemon-host.md` or successor run-control doc — document status/list error payloads.

## Prerequisites

- Daemon run-control API exposes run status/list over IPC.
- Invocation failures carry stable reason categories.
- Daemon-hosted unexpected run failures are captured durably.
