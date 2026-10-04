---
name: idle-watchdog-sidecar-filter-matches-any-path-segment
---

# Idle-watchdog sidecar filter matches any path segment

Unsplit rationale: The filter change, its regressions, and the operator doc update all live on the shared invocation idle-watchdog worktree-activity seam in `shared/invocation/agents.ts`; persistence, daemon, and CLI contracts are untouched.

## Primary implementation surface

- Shared invocation idle-output watchdog worktree-activity filtering in `shared/invocation/`

## Prerequisites

- The idle-output watchdog re-arms on debounced worktree filesystem activity under the invocation `cwd` via the injectable `watchWorktreeActivity` seam.
- Top-level sidecar paths whose basename starts with `.jarvis-` or matches `verdict-*.md` do not re-arm the idle timer.

## Problem

`isIgnoredWorktreeActivityPath` in `shared/invocation/agents.ts` matches only the path basename against `.jarvis-*` / `verdict-*.md`. Recursive `fs.watch` reports nested paths as `.jarvis-plan-stage/plan-body.md`, whose basename (`plan-body.md`) matches neither filter, so a write inside a `.jarvis-*` directory re-arms the timer. This diverges from the segment-level `.jarvis-` path convention in `v2/src/commands/cleanup.ts` (`isJarvisHarnessSidecarPath`); this filter must also cover `verdict-*.md` segments.

## Decision ledger

- Test each `/`-split path segment for the `.jarvis-` prefix and `verdict-*.md` pattern so nested sidecar writes do not re-arm; rules out the basename-only check.
- Preserve top-level sidecar filtering and genuine non-sidecar re-arm behavior unchanged; rules out over-broad filtering beyond the nested-segment gap.

## Acceptance criteria

- [ ] `agents.test.ts` proves `onActivity` for a nested sidecar path (e.g. `.jarvis-plan-stage/plan-body.md`) does NOT re-arm the idle timer — a nested-sidecar-only stream still settles `stall`; it fails against the pre-fix basename-only filter.
- [ ] `agents.test.ts` proves `onActivity` for a nested non-sidecar path (e.g. `src/nested/edited.ts`) still re-arms the idle timer.
- [ ] `agents.test.ts` `"sidecar-only worktree activity does not re-arm the idle timer"` stays green (top-level sidecar behavior unchanged).
- [ ] `agents.test.ts` `"worktree activity re-arms the idle timer for a silent child"` stays green (non-sidecar re-arm unchanged).
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the idle-watchdog sidecar-ignore rule matches any path segment, not just the basename.

## Blocker

Artifact contract check failed: Plan index does not link 00-ignore-sidecar-activity-in-any-path-segment.md
