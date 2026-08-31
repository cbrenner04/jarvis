# Match sidecar-ignore rule on any path segment

## Problem

`isIgnoredWorktreeActivityPath` in `shared/invocation/agents.ts` matches only the path basename against `.jarvis-*` / `verdict-*.md`. Recursive `fs.watch` reports nested paths as `.jarvis-plan-stage/plan-body.md`, whose basename (`plan-body.md`) matches neither filter, so a write inside a `.jarvis-*` directory re-arms the idle timer. This diverges from the segment-level `.jarvis-` path convention in `v2/src/commands/cleanup.ts` (`isJarvisHarnessSidecarPath`); this filter must also cover `verdict-*.md` segments.

## Surface

`isIgnoredWorktreeActivityPath` and its call sites in `shared/invocation/agents.ts`; co-located regressions in `shared/invocation/agents.test.ts`; the idle-watchdog sidecar-ignore prose in `v2/docs/write-behavior.md`. No change to the `watchWorktreeActivity` seam, debounce, stdout re-arm, stall settlement, or callers.

## Decision ledger

- Test each `/`-split path segment for the `.jarvis-` prefix and `verdict-*.md` pattern so nested sidecar writes do not re-arm; rules out the basename-only check.
- Preserve top-level sidecar filtering and genuine non-sidecar re-arm behavior unchanged; rules out over-broad filtering beyond the nested-segment gap.

## Work

- Change `isIgnoredWorktreeActivityPath` to ignore a path when any segment starts with `.jarvis-` or matches `verdict-*.md`.
- Add `agents.test.ts` regressions for nested sidecar and nested non-sidecar `onActivity` paths (see acceptance criteria).
- Update `v2/docs/write-behavior.md` so the sidecar-ignore rule names any path segment, not the basename alone.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` proves `onActivity` for a nested sidecar path (e.g. `.jarvis-plan-stage/plan-body.md`) does NOT re-arm the idle timer — a nested-sidecar-only stream still settles `stall`; it fails against the pre-fix basename-only filter.
- [ ] `shared/invocation/agents.test.ts` proves `onActivity` for a nested non-sidecar path (e.g. `src/nested/edited.ts`) still re-arms the idle timer.
- [ ] `shared/invocation/agents.test.ts` test `"sidecar-only worktree activity does not re-arm the idle timer"` stays green.
- [ ] `shared/invocation/agents.test.ts` test `"worktree activity re-arms the idle timer for a silent child"` stays green.
- [ ] `v2/docs/write-behavior.md` states the idle-watchdog sidecar-ignore rule matches any path segment, not just the basename.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — the idle-watchdog sidecar-ignore rule matches any path segment, not just the basename.
