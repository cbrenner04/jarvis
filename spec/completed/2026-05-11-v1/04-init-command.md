# 04 — `jarvis init`

Implement `jarvis init`. Run from the target repo's root.

## Behavior

In the current working directory:

- Register the target repo in `~/.jarvis/config.json`.
- Do not create or modify target-repo files.
- Jarvis-owned rules live in this harness repo under `rules/` and are injected
  into prompts.

## Tasks

- [ ] Implement `init` in `src/commands/init.ts`.
- [ ] Do not create, modify, or delete target-repo files.
- [ ] Register `cwd` as a project in `~/.jarvis/config.json` via `registerProject` (spec 02). Project name defaults to the basename of `cwd`; if that name is already registered to a different root, exit 1 with a clear message and suggest `jarvis config` to resolve it. Re-registering the same root is a no-op.
- [ ] Exit 0 if everything already exists and the project is already registered to this root.
- [ ] Tests use a temp working directory + injected config dir; cover register-from-empty, project-already-registered, and name-collision.

## Acceptance criteria

- Running in an empty dir only updates jarvis config.
- Running again is a no-op.

## Documentation updates

- Document `jarvis init` in `README.md` "Usage", including that it registers
  the current repo and writes no target-repo files.
