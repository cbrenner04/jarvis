# 00 — Config types, validation, and `resolvePlanFlags`

Extend the `Config`, `Project`, and `ModeConfig` TypeScript types and the config validator in `src/config.ts` to support two new optional flags — `specTimestamp` and `commit` — at both the global `modes.plan` level and the per-project `plan` override level. Add a `resolvePlanFlags` helper that centralizes two-level flag resolution.

## Context

Both new features (timestamped spec dirs and no-commit plan flow) share the same config shape and resolution logic. This subspec establishes that foundation so subspecs 01, 02, and 03 can call `resolvePlanFlags` without duplicating merge logic.

### Config shape

```json
// global default (inside existing "modes" key)
"modes": {
  "plan": {
    "agentOrder": [...],
    "specTimestamp": true,
    "commit": true
  }
}

// per-project override (inside existing "projects" entries)
"projects": {
  "my-work-repo": {
    "root": "/path/to/repo",
    "plan": {
      "specTimestamp": false,
      "commit": false
    }
  }
}
```

Resolution order (highest to lowest precedence):
1. `project.plan.specTimestamp` / `project.plan.commit`
2. `cfg.modes.plan.specTimestamp` / `cfg.modes.plan.commit`
3. Hardcoded default: `true` for both flags

### Type changes (`src/config.ts`)

- `ModeConfig` (around line 93): add `specTimestamp?: boolean` and `commit?: boolean`.
- `Project` (around line 75): add `plan?: { specTimestamp?: boolean; commit?: boolean }`.
- Config validator (around line 322): parse and validate the new `plan` block on project entries, mirroring how `git?: boolean` is handled. Both sub-fields are optional booleans.
- `DEFAULT_CONFIG` (around line 135): no change needed — omitting the fields lets `resolvePlanFlags` fall through to hardcoded defaults.

### `resolvePlanFlags` helper

Add to `src/config.ts` alongside existing config helpers:

```typescript
export function resolvePlanFlags(
  cfg: Config,
  project: Project | undefined,
): { specTimestamp: boolean; commit: boolean } {
  const globalPlan = cfg.modes?.plan;
  const projectPlan = project?.plan;
  return {
    specTimestamp: projectPlan?.specTimestamp ?? globalPlan?.specTimestamp ?? true,
    commit: projectPlan?.commit ?? globalPlan?.commit ?? true,
  };
}
```

## Tasks

- [ ] Add `specTimestamp?: boolean` and `commit?: boolean` to `ModeConfig` in `src/config.ts`
- [ ] Add `plan?: { specTimestamp?: boolean; commit?: boolean }` to the `Project` type in `src/config.ts`
- [ ] Update the config validator to parse and validate the new `plan` block on project entries (both fields are optional booleans; reject non-boolean values)
- [ ] Implement `resolvePlanFlags(cfg: Config, project: Project | undefined)` in `src/config.ts` and export it
- [ ] Verify that `jarvis config` (the `show` subcommand) surfaces the new fields correctly when set — since it dumps the full config as JSON, no display code change is needed beyond confirming the fields serialize

## Acceptance criteria

- [ ] `ModeConfig`, `Project`, and the validator all compile cleanly with the new optional fields
- [ ] `resolvePlanFlags` returns `{ specTimestamp: true, commit: true }` when no config overrides are present
- [ ] `resolvePlanFlags` returns the project-level value when set, regardless of the global value
- [ ] `resolvePlanFlags` returns the global `modes.plan` value when no project-level override is set
- [ ] The config validator rejects a non-boolean value for `project.plan.specTimestamp` or `project.plan.commit` with a descriptive error
- [ ] `resolvePlanFlags` accepts `undefined` for the `project` argument and falls through to global/hardcoded defaults
