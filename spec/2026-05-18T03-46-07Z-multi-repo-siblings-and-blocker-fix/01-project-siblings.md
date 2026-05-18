# 01 - Project siblings: multi-repo directory access

## Problem

The agent can only read/write the worktree and (when the spec lives outside the worktree) the spec directory. There is no way to declare that a project has sibling repositories the agent should also be able to edit. In the groceries layout (`groceries_features/`, `groceries-client/`, `groceries-service/` under `~/Work/groceries/`), fixes regularly need to land in `groceries-client/` but the agent has no access to it from inside the `groceries_features` worktree.

## Decisions

### Config schema

Extend `Project` in `src/config.ts` with an optional `siblings` field:

```ts
export type Project = {
  root: string;
  origin?: string;
  git?: boolean;
  siblings?: string[];   // absolute paths the agent gets --add-dir access to
};
```

Validation (mirroring the `root` pattern at lines 313–358 of `src/config.ts`):
- Each entry must be a non-empty string.
- Each entry must be an absolute path (`path.isAbsolute`).
- No cross-check against `root` is needed (siblings are not project roots).
- The field is optional; absent configs behave exactly as today.
- Add validation after the `gitRaw` check at line 351.

No config migration: the field is additive and optional.

### Merge point in `run.ts`

The function is `resolveModeSpecificPreflight` (line 320 of `src/modes/patch/run.ts`). The current `additionalReadDirs` declaration at line 418 is:

```ts
const additionalReadDirs = specOutsideWorktreeReadDirs({ specPath, agentWorkingDir });
```

Replace with:

```ts
const specDirs = specOutsideWorktreeReadDirs({ specPath, agentWorkingDir });
const projectSiblings = cfg.projects[project.key]?.siblings ?? [];
// existence-check each sibling here (see below)
const additionalReadDirs =
  specDirs !== undefined || projectSiblings.length > 0
    ? [...new Set([...(specDirs ?? []), ...projectSiblings])]
    : undefined;
```

`cfg` is in scope (used at line 389 for `worktreeSymlinks`). `project.key` is on the `ProjectMatch` object passed into the function. `existsSync` is already imported in `run.ts`.

### Existence check at run time

After computing `projectSiblings`, iterate and call `existsSync` on each entry. If any sibling path does not exist on disk, throw a descriptive `Error` naming the missing path and the project key — fail fast rather than silently dropping the entry. This mirrors how the worktree path is checked elsewhere in `prepareRun`.

### Non-claude agent warning

`resolveModeSpecificPreflight` does not have the active agent identity (agent selection via `buildActiveAgents` happens at line 249, before this function). Emit the warning at preflight time unconditionally when siblings are configured: use `opts.io.stderr(...)` (in scope in the closure) to note that non-claude agents will not receive `--add-dir` access to configured siblings. The message should list the sibling paths so the user knows what might be dropped. This fires once at run start and is imprecise only in the sense that it fires even when the active agent is claude — acceptable trade-off for simplicity.

The other four agents (`aider.ts`, `codex.ts`, `cursor.ts`, `opencode.ts`) do not read `additionalReadDirs` at all; do not add sibling handling to them in this change.

### Out of scope

- Per-sibling worktrees or branch isolation.
- `jarvis config project <name> --add-sibling <path>` CLI command (document the JSON shape instead).
- Global (non-per-project) siblings setting.
- Read-only vs read-write distinction (underlying `--add-dir` under `acceptEdits` is always read-write).

## Tasks

- [ ] In `src/config.ts`, add `siblings?: string[]` to the `Project` type.
- [ ] In `src/config.ts`, add validation for `siblings` in the `validateConfig` / project-validation block (after line 351): each entry must be a non-empty string and an absolute path; emit a descriptive error naming the project key and the offending entry.
- [ ] In `src/modes/patch/run.ts`, inside `resolveModeSpecificPreflight`, replace the `additionalReadDirs` const at line 418 with the two-step computation (specDirs + projectSiblings), including the existence check loop that throws on any missing sibling path.
- [ ] In `src/modes/patch/run.ts`, emit a `opts.io.stderr(...)` warning when `projectSiblings.length > 0`, noting that non-claude agents will not receive access to the listed sibling paths.
- [ ] Confirm `src/agents/claude.ts` requires no changes (it already iterates `additionalReadDirs` and appends `--add-dir`).
- [ ] Update `README.md` or project config documentation to describe the `siblings` field, its validation rules, and how to add entries by hand-editing `~/.jarvis/config.json`.

## Acceptance criteria

- [ ] A project registered in `~/.jarvis/config.json` with `"siblings": ["/abs/path/to/sibling"]` causes the agent to receive `--add-dir /abs/path/to/sibling` when running a spec against that project.
- [ ] If a configured sibling path does not exist on disk at run time, `jarvis run` exits with a clear error naming the missing path and the project — it does not silently drop the entry or proceed without access.
- [ ] Sibling entries that are not absolute paths are rejected during config validation with a descriptive error.
- [ ] A project with no `siblings` field (or `"siblings": []`) behaves identically to today — no regression.
- [ ] When siblings are configured, a warning is printed to stderr at run start (regardless of active agent) noting that non-claude agents will not receive `--add-dir` access, and listing the configured sibling paths.
- [ ] `src/agents/claude.ts` is confirmed unchanged (no functional diff).
- [ ] TypeScript compiles without errors.
- [ ] Documentation describes the `siblings` field and how to configure it.
