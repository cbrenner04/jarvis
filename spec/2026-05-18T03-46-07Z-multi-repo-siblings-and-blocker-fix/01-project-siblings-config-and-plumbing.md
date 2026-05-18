# 01 - Project siblings: config and shared run plumbing

## Problem

Jarvis has no project-level way to declare sibling repositories that belong to the same unit of work. In the groceries layout (`groceries_features/`, `groceries-client/`, `groceries-service/` under `~/Work/groceries/`), a spec may be routed through the `groceries_features` worktree while the fix belongs in `groceries-client/` or `groceries-service/`.

This subspec adds the shared config and run-loop plumbing only. Agent-specific CLI support is split into follow-up subspecs so every patch agent receives equivalent multi-repo support instead of silently degrading outside Claude.

## Decisions

### Config schema

Extend `Project` in `src/config.ts` with an optional `siblings` field:

```ts
export type Project = {
  root: string;
  origin?: string;
  git?: boolean;
  siblings?: string[];
};
```

Validation mirrors the existing `root` validation:
- Each entry must be a non-empty string.
- Each entry must be an absolute path (`path.isAbsolute`).
- The field is optional; absent configs behave exactly as today.
- No cross-check against `root` is required.
- Insert validation in the project-validation block after `git` validation and before assigning `projects[name] = project`.

No config migration is required because the field is additive and optional.

### Run-time validation and forwarding

In `src/modes/patch/run.ts`, inside `resolveModeSpecificPreflight`, merge sibling directories with the existing spec-outside-worktree directories:

```ts
const specDirs = specOutsideWorktreeReadDirs({ specPath, agentWorkingDir });
const projectSiblings = cfg.projects[project.key]?.siblings ?? [];
const additionalReadDirs =
  specDirs !== undefined || projectSiblings.length > 0
    ? [...new Set([...(specDirs ?? []), ...projectSiblings])]
    : undefined;
```

Before building `additionalReadDirs`, validate each configured sibling with `existsSync`. If a sibling path does not exist, throw a descriptive `Error` naming the missing path and the project key.

Keep using `additionalReadDirs` for this subspec to minimize churn. The name is historically misleading because Claude and Codex use these paths as writable workspace roots. A later cleanup may rename it, but this spec should not force that unrelated refactor.

### Prompt visibility

Do not rely on CLI flags alone. Update the patch-mode prompt construction so, when project siblings are configured, every agent is told the sibling paths are part of the allowed project workspace for the current run.

This is especially important for agents whose CLI workspace controls are broad (`cursor`, `opencode`) or file-list based (`aider`). The prompt text should be factual and concise, for example:

```md
Additional project sibling directories are available for this run:
- /abs/path/to/sibling

Treat these directories as part of the target project when the active spec requires cross-repo edits.
```

Choose the exact helper location based on the existing prompt code. The behavior must be covered by tests.

### No warning-only behavior

Do not print a warning that only Claude receives access. That was the previous draft and is no longer the desired behavior. If an agent cannot be made to support siblings, its agent-specific subspec must add a clear blocker instead of silently continuing.

## Out of scope

- Per-sibling worktrees or branch isolation.
- `jarvis config project <name> --add-sibling <path>` CLI command.
- Global sibling settings.
- Read-only vs read-write sibling declarations.
- Renaming `additionalReadDirs` across the codebase.

## Tasks

- [ ] In `src/config.ts`, add `siblings?: string[]` to the `Project` type.
- [ ] In `src/config.ts`, validate `siblings`: optional array, each entry a non-empty string, each entry absolute; errors must name the project key and offending entry.
- [ ] In `src/modes/patch/run.ts`, compute `projectSiblings` from `cfg.projects[project.key]?.siblings ?? []`.
- [ ] In `src/modes/patch/run.ts`, fail fast when a configured sibling does not exist on disk, with an error naming the missing path and project key.
- [ ] In `src/modes/patch/run.ts`, merge `specOutsideWorktreeReadDirs` and project siblings into `additionalReadDirs`, de-duped, preserving `undefined` when both are empty.
- [ ] Update patch prompt construction so configured sibling paths are listed for the agent as additional project workspace directories.
- [ ] Add or update tests covering config validation, run-time missing-sibling failure, merged/de-duped forwarding, and prompt text when siblings exist.
- [ ] Add a `## Project.siblings` section to `docs/config.md` describing the field, validation rules, and hand-editing `~/.jarvis/config.json`.

## Acceptance criteria

- [ ] A project registered with `"siblings": ["/abs/path/to/sibling"]` causes `jarvis run` to forward that path through `additionalReadDirs` for agent adapters.
- [ ] If a configured sibling path does not exist on disk at run time, `jarvis run` exits with a clear error naming the missing path and project.
- [ ] Sibling entries that are not absolute paths are rejected during config validation with a descriptive error.
- [ ] A project with no `siblings` field, or `"siblings": []`, behaves identically to today.
- [ ] The patch prompt lists configured sibling paths so all agents can reason about cross-repo work.
- [ ] TypeScript compiles without errors.
- [ ] `docs/config.md` has a `## Project.siblings` section describing the field, its validation rules, and how to hand-edit `~/.jarvis/config.json`.
