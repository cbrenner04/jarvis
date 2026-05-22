# Run external local specs reliably in patch mode

Patch mode must treat specs outside the target repo as first-class inputs. This
is required for plan specs created under Jarvis-owned storage by
`modes.plan.commit: false`.

## Context

Jarvis already documents that specs may live anywhere and that `repo:` can bind
an external spec to a target repository. This subspec turns that documented
shape into an explicit regression-protected contract for the plan-mode
no-commit path.

The important boundary is:

- The spec file lives in Jarvis-owned storage, outside the target repo.
- The agent working directory remains the resolved target repo.
- The agent must be able to read and update the external spec checklist.
- Git commits and PR behavior are governed by patch-mode `git` config, not by
  whether the spec path is inside the target repo.

If a target agent cannot edit files outside cwd without an explicit allowance,
Jarvis should provide the minimum additional read/write access needed for the
external spec tree using the existing agent-specific mechanisms. Do not broaden
access to the whole config directory if only the spec tree is needed.

## Tasks

- [ ] Audit patch-mode assumptions that derive paths relative to
      `project.root/spec/` or expect the spec directory to be inside the target
      repo.
- [ ] Ensure target repo resolution from an external spec's `repo:` line works
      for Jarvis-owned no-commit plan output.
- [ ] Ensure prompts mention the external spec path accurately while keeping the
      agent cwd as the target repo.
- [ ] Ensure agents get the minimum required access to read and update the
      external spec tree when the spec path is outside cwd.
- [ ] Ensure completion detection, acceptance-criteria ticking, blocker
      detection, WIP commits, and final subspec commits all operate on the
      external spec files.
- [ ] Define and test git behavior when an external spec is used with
      patch-mode `git: true`: implementation files are committed in the target
      repo while the external spec checklist update is not accidentally staged
      into the target repo.
- [ ] Define and test loop-only behavior when patch-mode `git: false`: the
      external spec checklist can still be updated and no target-repo git
      operations are attempted.

## Acceptance criteria

- [x] `jarvis run <absolute-jarvis-storage>/index.md` resolves the target repo
      from `repo:` and invokes the agent in the target repo cwd.
- [x] The active subspec and index checkbox can be updated when the spec tree is
      outside the target repo.
- [x] With patch-mode `git: true`, implementation commits do not attempt to
      stage or commit external spec files that live outside the target repo.
- [x] With patch-mode `git: false`, an external spec can be completed without
      creating a worktree, branch, commit, push, or PR.
- [x] Existing in-repo spec behavior remains unchanged.
- [x] Missing or unresolvable `repo:` metadata on an external spec fails with a
      clear error before invoking an agent.

## Documentation updates

- [x] Defer broad docs to `02-docs-and-cleanup.md`; update inline comments only
      where needed to distinguish target-repo cwd from spec-file location.
