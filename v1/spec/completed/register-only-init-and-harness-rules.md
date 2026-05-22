# Register-only init and harness-owned rules

`jarvis init` should register target repos without writing jarvis files into
them. Jarvis-specific rules and workflow doctrine belong to this harness repo,
so they can be versioned and synced between machines.

## Decisions

- Target repos should not receive jarvis-created files.
- `jarvis init` registers the current working directory as the project root.
- Project names are paths relative to `~/Work`.
- There is no workspace concept. Each repo is initialized independently.
- Specs may continue to live wherever the current run-resolution rules require;
  this spec does not redesign spec location.
- Existing scaffold files from older jarvis versions are not migrated, deleted,
  or warned about.
- Target-repo guidance discovery is delegated to the underlying agent.
- Harness-owned rules are injected into the prompt directly, not referenced by
  path.

## Behavior

### `jarvis init`

Run from a target repo directory:

- Resolve the current working directory to an absolute path.
- Register that path in `~/.jarvis/config.json`.
- Derive the project name from the path relative to `~/Work`.
  - Example: `/Users/me/Work/app-a` registers as `app-a`.
  - Example: `/Users/me/Work/client/api` registers as `client/api`.
- If the current directory is not under `~/Work`, exit 1 with a clear message.
- If the same project name is already registered to the same root, exit 0.
- If the same project name is registered to a different root, exit 1 and point
  the user at `jarvis config`.
- If a different project name is already registered to the same root, preserve
  the existing duplicate-root validation behavior.

Do not create, modify, or delete any target-repo files or directories,
including:

- `README.md`
- `AGENTS.md`
- `spec/`
- `.jarvis/`

### Harness-owned rules

Add compact default rules to this harness repo under `rules/`:

- `rules/patch-mode.md`

This file is a jarvis implementation input, not a target-repo template.

### Prompt

Update `jarvis run` prompt construction so it no longer assumes target guidance
is in `README.md` or linked from `README.md`.

The prompt should:

- Tell the agent to inspect the target repo for guidance, conventions, and
  relevant docs.
- Tell the agent to read the spec path passed to jarvis.
- Include the compact harness-owned rules inline.
- Tell the agent to pick the single most important unchecked task and complete
  it.
- Leave target-repo guidance discovery to the agent.

Suggested shape:

```text
Inspect the target repo for guidance, conventions, and relevant docs.
Read the spec at <SPEC_PATH>.
Follow these Jarvis rules:
<compact rules>
Pick the single most important unchecked task and complete it.
```

## Tasks

- [x] Change `src/commands/init.ts` so `init` only registers the current
  directory and never scaffolds target-repo files.
- [x] Add project-name derivation from the current directory relative to
  `~/Work`.
- [x] Add compact harness-owned rule files under `rules/`.
- [x] Update prompt construction to inject the harness-owned rules and remove
  hardcoded `README.md` assumptions.
- [x] Update tests for register-only init behavior, including:
  - no target files or directories are created
  - project key is relative to `~/Work`
  - nested repos under `~/Work` use nested relative keys
  - directories outside `~/Work` fail clearly
  - re-running init on the same registered root is a no-op
- [x] Update prompt tests to assert repo-guidance discovery wording and inline
  Jarvis rules.
- [x] Update README usage docs for `jarvis init` and prompt behavior.
- [x] Update AGENTS.md core decisions if the documented loop prompt changes.

## Acceptance criteria

- Running `jarvis init` in an unregistered repo under `~/Work` only updates
  `~/.jarvis/config.json`.
- Running `jarvis init` does not create `README.md`, `AGENTS.md`, `spec/`, or
  `.jarvis/`.
- Registered project keys are relative paths from `~/Work`.
- `jarvis run` prompt does not hardcode `README.md` as the required guidance
  source.
- Harness-owned rules are included inline in the prompt.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- README: document that `jarvis init` is register-only and writes no files to
  target repos.
- README: document that jarvis-owned rules live in this harness repo under
  `rules/` and are injected into agent prompts.
- AGENTS.md: update the loop prompt section so it matches the new prompt shape.
