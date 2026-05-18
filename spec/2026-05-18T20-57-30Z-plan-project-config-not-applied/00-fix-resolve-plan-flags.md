# Fix plan.ts and config.ts to pass full project to resolvePlanFlags

## Problem

`jarvis plan` ignores project-level `plan` config (`specTimestamp`, `commit`) even when the running project has those keys set. The top-level `modes.plan` values always win.

Two related bugs cause this:

**Bug 1 — main plan path (`src/commands/plan.ts:525`):**
`entry.resolution.resolved.project` is a `ProjectMatch` (fields: `key`, `root`, `origin`). It has no `plan` field. This bare `ProjectMatch` is passed directly to `resolvePlanFlags(cfg, project)`. Inside `resolvePlanFlags`, `project?.plan` is always `undefined`, so project-level overrides are silently skipped.

**Bug 2 — resume path (`src/config.ts:761–765`):**
`findProjectForPath()` reconstructs a `Project` object copying only `root` and `origin` from the matched entry, dropping the `plan` field. Any caller that uses `findProjectForPath` to get a project (including the resume path in `plan.ts`) also loses project-level plan config.

## Fix

### Bug 1 — `src/commands/plan.ts:525`

After line 519 where `project` is assigned, look up the full `Project` from `cfg` (already in scope) and pass it to `resolvePlanFlags` instead of the bare `ProjectMatch`:

```ts
// Before (line 525):
const { specTimestamp, commit } = resolvePlanFlags(cfg, project);

// After:
const fullProject = cfg.projects[project.key];
const { specTimestamp, commit } = resolvePlanFlags(cfg, fullProject);
```

`cfg` is loaded earlier in the same function and is already in scope — no additional load needed.

### Bug 2 — `src/config.ts:753–766`

In `findProjectForPath`, after building the `Project` object from the match, also copy the `plan` field from the full config entry:

```ts
export function findProjectForPath(
  p: string,
  opts?: ConfigOptions,
): Project | undefined {
  const match = findProjectMatchForPath(p, opts);
  if (match === undefined) {
    return undefined;
  }
  const cfg = loadConfig(opts);
  const project: Project = { root: match.root };
  if (match.origin !== undefined) {
    project.origin = match.origin;
  }
  const full = cfg.projects[match.key];
  if (full?.plan !== undefined) {
    project.plan = full.plan;
  }
  return project;
}
```

`loadConfig` reads a small JSON file and is not in a hot path; the double load is acceptable.

## Acceptance criteria

- [ ] `src/commands/plan.ts`: line 525 uses `cfg.projects[project.key]` (a `Project | undefined`) rather than the raw `ProjectMatch` when calling `resolvePlanFlags`.
- [ ] `src/config.ts`: `findProjectForPath` calls `loadConfig(opts)` after `findProjectMatchForPath`, looks up the full project entry, and copies `plan` to the returned `Project` when present.
- [ ] No type changes are required — `Project` already has `plan?: { specTimestamp?: boolean; commit?: boolean }`.
- [ ] `bun run typecheck` passes with no new errors.
