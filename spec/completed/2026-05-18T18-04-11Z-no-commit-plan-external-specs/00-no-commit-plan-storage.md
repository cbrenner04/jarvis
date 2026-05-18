# Store no-commit plan specs outside target repos

When `modes.plan.commit` resolves to `false`, plan mode must not write generated
spec files under the target repository checkout. In particular, it must not seed
or leave `spec/tmp-*` directories in a directory that may be tracked by the
target repo's git history.

## Context

The current `commit: false` plan flow reuses `worktreePath = project.root`, so
all phase helpers write through the normal `spec/<name>/` path inside the target
repo. That avoided git/gh operations, but it still puts authored spec files in
the target repo's working tree. For no-commit projects, that is the wrong
ownership boundary: Jarvis should own these local-only specs.

Use a Jarvis-owned spec root under the configured Jarvis config directory,
not the target repository. A concrete path is:

```text
<config-dir>/specs/<project-key-or-safe-id>/<spec-dir-basename>/
```

The default config dir is `~/.jarvis`, so normal production paths look like:

```text
~/.jarvis/specs/groceries_features/<spec-dir-basename>/index.md
```

The project segment should be deterministic and filesystem-safe. Prefer the
registered project key when available. For ad-hoc projects, derive a stable
safe segment from the target repo identity already used by project resolution;
do not use arbitrary absolute paths directly as directory names.

The generated `index.md` must include a portable `repo:` binding so `jarvis run`
can resolve the target checkout later even though the spec path no longer lives
inside it. Prefer an origin URL/slug when available; fall back to the registered
project key only if that is the existing resolver contract.

## Tasks

- [ ] Add a helper that computes the Jarvis-owned spec storage root for a
      resolved project and plan config directory.
- [ ] Route `commit: false` initial plan runs through that storage root instead
      of `project.root`.
- [ ] Keep `commit: true` behavior unchanged: temporary worktree, final
      `spec/<spec-dir>/` in the plan branch, commits, pushes, and PR creation.
- [ ] Ensure no `spec/tmp-*` directory is created under the target repo during
      `commit: false` refine, naming-only, draft, review, blocker, or error
      paths.
- [ ] Seed or inject a portable `repo:` line into generated no-commit
      `index.md` output.
- [ ] Update final stdout for `commit: false` to print the absolute local spec
      path and a `jarvis run <absolute-index-path>` command.
- [ ] Preserve disk-collision protection in the Jarvis-owned storage root.

## Acceptance criteria

- [x] With `modes.plan.commit: false`, `jarvis plan --repo <project> intent.md`
      writes `index.md`, `intent.md`, and subspecs under Jarvis-owned storage,
      not under `<project.root>/spec/`.
- [x] A failed `commit: false` refine or naming-only run leaves no
      `<project.root>/spec/tmp-*` directory behind.
- [x] A successful `commit: false` plan produces an `index.md` with a usable
      `repo:` binding for the target repo.
- [x] The final stdout points to the external absolute `index.md` path and
      shows a matching `jarvis run` command.
- [x] Running the same no-commit plan name twice fails with a clear collision
      error in Jarvis-owned storage rather than overwriting the prior spec.
- [x] `commit: true` plan-mode tests and behavior are unchanged.

## Documentation updates

- [x] Defer broad docs to `02-docs-and-cleanup.md`; add only code comments that
      clarify non-obvious path ownership decisions.
