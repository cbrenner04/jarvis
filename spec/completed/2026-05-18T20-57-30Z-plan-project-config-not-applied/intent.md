---
name: plan-project-config-not-applied
---
i just ran 'jarvis plan' in jarvis which is configured to commit specs and configured to prepend a timestamp to the spec dir name and yet it did neither of those things. /Users/christopherbrenner/Work/jarvis/spec/checks-before-pr-ready if you need it but it won't really show you anything. you can see the config in ~/.jarvis/config.json

## Refine turn 1

### Root cause (two related bugs)

**Bug 1 — main plan path (`src/commands/plan.ts:519`):**
`entry.resolution.resolved.project` returns a `ProjectMatch` (type has `key`, `root`, `origin` but no `plan` field). This is passed directly to `resolvePlanFlags(cfg, project)` at line 525. Inside `resolvePlanFlags` (`src/config.ts:740`), `project?.plan` is always `undefined` for a `ProjectMatch`, so the project-level overrides are silently skipped and the top-level `modes.plan` values win.

The user's config has `modes.plan.specTimestamp: false` and `modes.plan.commit: false` at the top level, but the jarvis project entry has `projects.jarvis.plan.specTimestamp: true` and `projects.jarvis.plan.commit: true`. Because the project-level `plan` field is never consulted, the top-level `false` values win.

**Bug 2 — resume path (`src/commands/plan.ts:287` / `src/config.ts:753`):**
`findProjectForPath()` calls `findProjectMatchForPath()`, then reconstructs a `Project` object copying only `root` and `origin` — it omits the `plan` field. The resulting `Project` passed to `resolvePlanFlags` also has no `plan` field, so project-level plan config is likewise ignored on resume.

### Fix locations

1. **`src/commands/plan.ts:519`** — after `const project = entry.resolution.resolved.project;`, look up the full project: `const fullProject = cfg.projects[project.key];` and pass `fullProject` (a `Project | undefined`) to `resolvePlanFlags` instead of the bare `ProjectMatch`.

2. **`src/config.ts:761–765`** (`findProjectForPath`) — when building the returned `Project`, also copy the `plan` field from the matched project entry: `if (project.plan !== undefined) { result.plan = project.plan; }`. This fixes the resume path.

### Scope

- No changes to config schema or types needed; `Project` already has `plan?: { specTimestamp?: boolean; commit?: boolean }` and `resolvePlanFlags` already handles it correctly once populated.
- Tests should cover: project-level `specTimestamp`/`commit` overriding top-level mode defaults (for both the main path and the resume path).
- No CLI interface changes required.

## Refine turn 2

### Implementation detail for Bug 2 fix

`findProjectForPath` (config.ts:753–766) calls `findProjectMatchForPath`, which internally calls `loadConfig`. However, the returned `ProjectMatch` carries only `key`, `root`, and `origin` — not the full `Project` including the `plan` field. After the match is returned, the function has no reference to the loaded config.

The cleanest fix is to call `loadConfig(opts)` inside `findProjectForPath` after getting the match, then look up `cfg.projects[match.key]` to read the `plan` field:

```ts
export function findProjectForPath(p: string, opts?: ConfigOptions): Project | undefined {
  const match = findProjectMatchForPath(p, opts);
  if (match === undefined) return undefined;
  const cfg = loadConfig(opts);          // second load, cheap — config is typically tiny
  const project: Project = { root: match.root };
  if (match.origin !== undefined) project.origin = match.origin;
  const full = cfg.projects[match.key];
  if (full?.plan !== undefined) project.plan = full.plan;
  return project;
}
```

This is a double-load of config, but `loadConfig` reads a small JSON file and is not in a hot path. No type changes are needed.

### Test placement

- **`test/config.test.ts`** — add a unit test for `findProjectForPath` asserting that a project with a `plan` field returns a `Project` with that field populated. Place it alongside the existing `resolvePlanFlags` describe block.
- **`test/plan-command.test.ts`** — the main-path fix (plan.ts:525) can be tested by wiring a temp config with a project that has `plan: { specTimestamp: false, commit: false }` against global defaults of `true`, and asserting the resolved flags match the project-level values. Look at how existing tests in that file set up temp config dirs via `registerProject` and `mkdtempSync`.

### `cfg` availability in plan.ts

In the main plan path, `cfg` is already in scope (loaded earlier in the same function), so `cfg.projects[project.key]` is a simple one-line lookup — no additional load needed.

## Refine skip

Code-verified: `resolved.project` is confirmed as `ProjectMatch` (typed in `src/modes/shared-entry.ts:32`), and `findProjectForPath` at `src/config.ts:761–765` is confirmed to omit the `plan` field. Both bugs and all fix details from turns 1–2 are accurate. No further refinement needed; ready to draft.


## Blocker

Out-of-bounds write detected. The following paths were modified outside `spec/plan-project-config-not-applied/` and have been reverted:

  - `spec/checks-before-pr-ready/`

Spec-file write boundary is enforced: only files under `spec/plan-project-config-not-applied/` may be modified.