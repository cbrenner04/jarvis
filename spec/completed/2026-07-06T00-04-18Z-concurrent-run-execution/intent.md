---
name: concurrent-run-execution
---
# Concurrent Run Execution

# Concurrent run execution

The daemon executes multiple admitted runs in parallel rather than serializing
them, so two or more non-queued runs make progress at the same time.

## Prerequisites

- Memory-watermark admission and `queued` status exist
