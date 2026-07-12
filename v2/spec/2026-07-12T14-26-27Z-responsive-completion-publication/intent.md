---
name: responsive-completion-publication
---
# Keep daemon IPC responsive during completion publication

Make completion push, GitHub authentication, PR lookup/creation, and PR-body refresh fully asynchronous. Preserve retries and publication ordering, and prove unrelated IPC remains responsive while publication commands are pending.

## Prerequisites

## Decisions

- Await each publication command and retry attempt; rules out fire-and-forget publication — completion still observes failures before advancing.
- Keep push, PR ensure, and body refresh ordered; rules out parallel publication that can edit a PR before it exists.

## Out of scope

- Ready-gate execution and draft-to-ready transition.
- Moving runs to workers or cancelling commands.

## Documentation updates

- Update the durable daemon architecture documentation for asynchronous completion publication.
