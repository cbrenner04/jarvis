---
name: responsive-daemon-run-git
---
# Keep daemon IPC responsive during run Git work

Convert synchronous Git subprocesses reached during daemon-hosted run execution—including commit, attribution, review rendering, intent output, and workflow operations—to awaited asynchronous calls. Prove unrelated IPC remains responsive while representative run Git work is pending.

## Prerequisites

## Decisions

- Cover every Git subprocess reachable from an in-process run; rules out limiting the change to the seed's initially observed files — the invariant applies to the whole run path.
- Preserve command output, failure, and ordering semantics; rules out parallelizing dependent Git operations merely because invocation becomes asynchronous.

## Out of scope

- Completion publication, ready finalization, and RPC admission.
- Moving runs to workers or cancelling commands.

## Documentation updates

- Update the durable daemon architecture documentation for asynchronous run-path Git operations.
