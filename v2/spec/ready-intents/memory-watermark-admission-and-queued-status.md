---
name: memory-watermark-admission-and-queued-status
---
# Memory Watermark Admission And Queued Status

# Memory-watermark admission and queued status

Daemon gates new-run admission on an adaptive memory watermark. A run that
cannot be admitted is persisted with a new `queued` `RunStatus` instead of
starting immediately; once memory drops back under the watermark, queued runs
are admitted in order (no preemption of already-running runs).

## Prerequisites

- Daemon supports starting a run against the workflow runner
