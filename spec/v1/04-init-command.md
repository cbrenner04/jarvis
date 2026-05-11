# 04 — `jarvis init` (target-repo scaffolding)

Implement `jarvis init`, which scaffolds the files jarvis expects in a *target* repo. Run from the target repo's root.

## Files scaffolded

In the current working directory:

- `README.md` — created if missing; if present, **not modified** (print a warning). The default content points at `STYLE.md`, `SAFETY.md`, and instructs the agent how to find the active spec.
- `STYLE.md` — created if missing; minimal default rules.
- `SAFETY.md` — created if missing; minimal default rules.
- `spec/` directory — created if missing.

Default `STYLE.md`:

```
# Style
- Match existing style; do not reformat unrelated code.
- No TODO comments — write tasks in the spec instead.
- Adding a dependency requires recording the decision in the spec, then stopping.
```

Default `SAFETY.md`:

```
# Safety
- Work on exactly one task per iteration.
- Run the project's tests/typecheck before marking a task done.
- If blocked or ambiguous, write the blocker into the spec and stop.
- If you repeat a failed approach, stop and write the failure into the spec.
- Leave the working tree clean and compiling.
```

Default `README.md` (target repo):

```
# <repo>
This repo uses jarvis. Rules: see STYLE.md and SAFETY.md. Work from the spec passed on the jarvis command line.
```

## Tasks

- [ ] Implement `init` in `src/commands/init.ts`.
- [ ] Each scaffolded file: skip-if-exists with a printed notice; create-if-missing with default content.
- [ ] Register `cwd` as a project in `~/.jarvis/config.json` via `registerProject` (spec 02). Project name defaults to the basename of `cwd`; if that name is already registered to a different root, exit 1 with a clear message and suggest `jarvis config` to resolve it. Re-registering the same root is a no-op.
- [ ] Exit 0 if everything already exists and the project is already registered to this root.
- [ ] Tests use a temp working directory + injected config dir; cover create-from-empty, skip-if-exists, project-already-registered, and name-collision.

## Acceptance criteria

- Running in an empty dir produces all four entries.
- Running again is a no-op (only prints "already exists" notices).

## Documentation updates

- Document `jarvis init` in `README.md` "Usage", including which files it creates and that it never overwrites.
