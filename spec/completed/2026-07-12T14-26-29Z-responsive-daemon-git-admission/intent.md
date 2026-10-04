---
name: responsive-daemon-git-admission
---
# Keep daemon admission responsive during Git work

Make the shared subprocess seam asynchronous without breaking v1 callers, and migrate daemon-hosted worktree setup, repository probes, and `resume`/`revise` dirty checks. While those Git commands are pending, unrelated IPC requests must still complete.

## Prerequisites

## Decisions

- Preserve v1 behavior while adding or migrating the shared async runner; rules out a v2-only fork of shared subprocess code — shared remains the version-agnostic seam.
- Await the dirty-worktree probe inside `resume`/`revise`; rules out moving the synchronous probe behind another synchronous wrapper.

## Out of scope

- Completion publication and ready-gate commands.
- Moving runs to workers or cancelling commands.

## Documentation updates

- Update the durable daemon architecture documentation for asynchronous admission and worktree subprocesses.
