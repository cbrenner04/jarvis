# 02 - External worktrees with v1 lock semantics

## Decisions

- Build a v2 worktree helper for external materialization under `~/.jarvis/worktrees`; do not reuse `v1/src/worktree.ts`.
- Keep worktree lifecycle outside `write`; the runner call site supplies naming inputs and receives a prepared checkout.
- Reuse the v1 `.jarvis.lock` JSON payload and busy-vs-stale semantics exactly.
- Hold the lock from acquisition through result materialization.
- Apply best-effort `info/exclude` handling compatible with v1.
- Accept explicit project/worktree naming inputs instead of deriving names from spec-path conventions.
- Keep branch naming and slug policy narrow to the first live materialization call site.
- Deferred to first consumer: collision suffixing and broader naming normalization beyond the first passing path — pin when a caller needs it.

## Constraints

- Do not move worktree ownership into `write`.
- Do not add durable state, resume metadata, or branch/PR lifecycle.
- Keep the helper usable by a host-agnostic runner.
- Match existing stale-lock handling; do not invent a v2-only format or recovery rule.

## Task checklist

- Add one external worktree acquisition/materialization helper.
- Implement lock acquire, stale-lock recovery, and release with the existing `.jarvis.lock` contract.
- Materialize and reuse worktrees under `~/.jarvis/worktrees/<project>/<branch>/`.
- Add fresh-lock, stale-lock, and busy-lock tests.
- Leave operator docs to the live `write` slice unless this helper creates a standalone durable contract.

## Acceptance criteria

- [x] Phase 1 code can create or reuse a worktree under `~/.jarvis/worktrees/<project>/<branch>/` from explicit naming inputs supplied by the caller.
- [x] The helper writes and reads the same `.jarvis.lock` JSON payload shape and enforces the same busy-vs-stale behavior v1 already uses.
- [x] Lock lifetime spans worktree acquisition through result materialization, and release happens on both success and failure paths.
- [x] Best-effort `info/exclude` handling matches the compatible v1 semantics for the external worktree path.
- [x] Tests cover at least one fresh acquisition, one stale-lock recovery, and one busy-lock refusal.

## Documentation updates

- No standalone operator doc in this subspec unless the helper exposes operator-facing semantics on its own.
- Document worktree location and verification flow in `03`.
