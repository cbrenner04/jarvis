# 01 - External worktree materialization and lock reuse

## Decisions

- Pin the Phase 1 worktree home to `~/.jarvis/worktrees/<project>/<branch>/`.
- Implement Phase 1 worktree materialization in a v2-specific helper; do not reuse `v1/src/worktree.ts`.
- Reuse existing `.jarvis.lock` semantics end to end only through shared extraction; do not invent a v2-only lock format or location.
- Hold the cross-process lock for the full one-shot run from worktree acquisition through result materialization.
- Reuse the existing busy-vs-stale lock behavior only if it falls out of the shared extraction cleanly; otherwise prove busy-path coexistence now and defer stale-healing expansion to the first consumer that needs it.
- Preserve the best-effort `info/exclude` protection that keeps `.jarvis.lock` out of staging when a worktree is acquired.
- Treat the external worktree plus git checkout as the only persisted run state in Phase 1; do not add SQLite bootstrap, run rows, attempt ledgers, or transcript storage.
- Defer to first consumer: worktree naming slug, collision suffixing, and branch naming details under `~/.jarvis/worktrees` — pin when the materialization call site chooses the final path keys.

## Tasks

- Add the v2 worktree helper for create-or-reuse under `~/.jarvis/worktrees`.
- Extract or duplicate only the compatible lock semantics needed to share `.jarvis.lock` behavior without cross-tree imports.
- Wire the Phase 1 core to acquire the external worktree before invocation and keep it through result materialization.
- Add isolated tests for worktree path selection, create-vs-reuse behavior, busy-lock coexistence, and the Phase 1 observable side effects.

## Documentation updates

- Update `v2/docs/v2-architecture.md` to pin the external worktree path and the Phase 1 lock lifetime if those details are not already durable there.
- Add or update a durable `v2/docs/` operator-facing home for worktree location and `.jarvis.lock` behavior if no existing doc fits cleanly.

## Acceptance criteria

- [x] A successful Phase 1 write-step test materializes output in an external worktree under `~/.jarvis/worktrees/<project>/<branch>/`, with automated coverage proving create-or-reuse behavior.
- [x] Phase 1 worktree acquisition uses the reused `.jarvis.lock` contract rather than a new v2-only format, and automated coverage proves busy-lock coexistence for the external worktree path.
- [x] No Phase 1 code path persists run state outside the external worktree and git checkout; no SQLite bootstrap or run ledger lands in this subspec.
- [x] Durable docs in `v2/docs/` describe the external worktree location and the lock behavior operators can observe during a one-shot Phase 1 run.
