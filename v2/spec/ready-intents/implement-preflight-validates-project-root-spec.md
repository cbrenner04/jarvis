---
name: implement-preflight-validates-project-root-spec
---

# Implement preflight validates project-root spec paths

`jarvis run workflow implement` must, before daemon or worktree creation, require `--spec` and `--artifact` to exist and to remain within the registered project root after symlink resolution. It then passes their project-relative paths to the write step. A first launch whose spec exists at the project root but whose worktree does not yet exist must reach the write step.

## Decisions

- Preflight resolves the registered project root and each existing operator path through symlinks, then requires the resolved path to be contained by the resolved root. It rejects missing or escaping paths before daemon or worktree creation — rules out requiring files in a not-yet-created worktree and treating "against root" as a mere resolution base.
- Keep project-relative paths for write-step consumption — rules out passing project-root absolute paths into the worktree runtime.
- Apply the same preflight root to explicit non-index `--artifact` paths — rules out fixing only `--spec` while artifact validation retains the launch cycle.

## Out of scope

- Live pause or kill for workflow-started implement runs.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — confirm project-root validation and worktree-relative write consumption.
- `v2/docs/write-behavior.md` — align implement path-resolution and preflight semantics.
- `v2/docs/v1-behaviors.md` — record the corrected v2 implement launch behavior.

## Prerequisites
