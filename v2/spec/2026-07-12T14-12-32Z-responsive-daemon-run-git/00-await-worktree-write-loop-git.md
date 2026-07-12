# Await worktree and write-loop Git

Make daemon-hosted worktree setup and write-loop Git yield to the event loop.

## Decisions

- Convert every daemon-reachable Git call in worktree setup and the write loop; rules out leaving validation, branch, worktree-prune, or changed-file calls synchronous.
- Preserve output encoding, buffering, trimming, failures, fallbacks, and sequential setup/cleanup order; rules out changing subprocess contracts while making them awaitable.
- Keep in-flight Git uncancelled; rules out adding cancellation beyond committed daemon abort/shutdown semantics.

## Tasks

- [x] Replace synchronous Git execution in external worktree setup/reuse and write-loop Git helpers with awaited execution, propagating async contracts through daemon-hosted callers.
- [x] Preserve worktree setup, reuse, cleanup, changed-file, and error/fallback behavior.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with awaited worktree/write-loop Git on daemon-hosted runs.
- Update `v2/docs/v1-behaviors.md` with the changed existing worktree/write-loop behavior.

## Acceptance criteria

- [x] `v2/src/execution/external-worktree.test.ts` stays green for daemon-reachable worktree setup, reuse, and cleanup behavior.
- [x] `v2/src/execution/write-loop.test.ts` stays green for write-loop Git behavior.
- [x] `v2/docs/v2-architecture.md` and `v2/docs/v1-behaviors.md` document awaited daemon run worktree/write-loop Git.
