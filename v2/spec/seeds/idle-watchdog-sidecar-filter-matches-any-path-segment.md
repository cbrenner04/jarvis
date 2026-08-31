---
name: idle-watchdog-sidecar-filter-matches-any-path-segment
---

# Idle-watchdog sidecar filter is basename-only; nested sidecar writes still re-arm

## Problem

The idle-output watchdog's worktree-activity re-arm (from `idle-watchdog-counts-worktree-activity`) ignores harness sidecar churn via `isIgnoredWorktreeActivityPath` in `shared/invocation/agents.ts`, which matches only the path **basename** against `.jarvis-*` / `verdict-*.md`. Recursive `fs.watch` reports nested paths as `.jarvis-plan-stage/plan-body.md`, whose basename (`plan-body.md`) matches neither filter, so a write inside a `.jarvis-*` directory re-arms the timer. This diverges from the any-segment sidecar convention used elsewhere (`v2/src/commands/cleanup.ts` sidecar detection, intent-output), though it matches the basename convention in `write-loop.ts`.

## Evidence (2026-08-31)

Independent review of the idle-watchdog implement (#3218): confirmed empirically that Bun recursive `fs.watch` on macOS reports nested paths in `<dir>/<file>` form, and `isIgnoredWorktreeActivityPath` checks basename only, so `.jarvis-plan-stage/plan-body.md` re-arms. Not shipped as a bug (masking risk is low — during a live invocation the only writer into `.jarvis-intent-stage/` / `.jarvis-plan-stage/` is the splitter/planner agent itself, which is real work worth re-arming on), but the semantics are inconsistent and undefended.

## Decisions

- Match the sidecar filter on **any path segment** (split on `/`, test each segment against the `.jarvis-` prefix / `verdict-*.md` pattern), so a nested sidecar write does not re-arm — matching the any-segment convention in `cleanup.ts`. Rules out the basename-only check.
- Preserve the current behavior for top-level sidecar writes and for genuine agent edits to real files. Rules out over-broad filtering (a real repo file whose own basename starts `.jarvis-` stays filtered as today; scope of this seed is the nested-segment case only).

## Acceptance criteria

- [ ] An `agents.test.ts` test proves an `onActivity` for a nested sidecar path (e.g. `.jarvis-plan-stage/plan-body.md`) does NOT re-arm the idle timer (a nested-sidecar-only stream still settles `stall`); it fails against the pre-fix basename-only filter.
- [ ] A test proves a nested NON-sidecar path (e.g. `src/nested/edited.ts`) still re-arms.
- [ ] The existing top-level sidecar and non-sidecar behavior is unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the idle-watchdog sidecar-ignore rule matches any path segment, not just the basename.
