# Preflight implement paths

Validate implement workflow inputs in the registered project checkout before daemon contact or worktree creation, then preserve project-relative paths for the write step.

## Decisions

- Resolve the registered project root and each effective operator path through symlinks before containment checks. Lexical containment alone is insufficient because an in-root symlink may escape.
- Require the source `--spec` to exist. For an index launch, that same file remains the effective artifact and an explicit `--artifact` remains ignored. For a non-index launch, require the explicit `--artifact` to exist and validate it against the same resolved project root.
- Reject a missing or escaping effective path before daemon contact or worktree creation, with an error identifying whether the spec or artifact failed.
- Convert validated source-checkout paths to paths relative to the resolved project root before building workflow steps. The write runtime consumes those relative paths inside its eventual worktree.
- Validate against the registered source checkout even when the branch worktree does not exist. A first launch must not inspect or require files in that future worktree.

## Work

- Harden implement CLI preflight for existence, symlink resolution, and resolved-root containment of the effective spec and artifact.
- Preserve the matched project identity and pass project-relative spec/artifact paths into the workflow builder.
- Add focused CLI and workflow execution coverage for missing paths, symlink escapes, valid in-project symlinks, non-index artifacts, and first launch before worktree creation.
- Update the implement launch documentation and v1 behavior catalog.

## Acceptance criteria

- [ ] `jarvis run workflow implement` rejects a missing `--spec` before daemon contact or worktree creation and identifies the spec path in the error.
- [ ] A spec whose resolved target escapes the resolved registered project root is rejected before daemon contact or worktree creation, including when its lexical path is inside that root.
- [ ] A non-index launch rejects a missing explicit `--artifact` and an artifact whose resolved target escapes the same resolved project root before daemon contact or worktree creation.
- [ ] Valid spec and effective artifact paths reached through symlinks remain accepted when their resolved targets are contained by the resolved registered project root.
- [ ] An index launch continues to use the resolved spec as its artifact and ignores a supplied `--artifact`.
- [ ] A first launch with the spec present in the registered project root reaches the implement write step when its branch worktree does not yet exist; the step receives project-relative spec and artifact paths.
- [ ] `v2/src/cli.test.ts` and focused implement workflow execution tests cover path preflight ordering and write-step path consumption.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — state that implement validates source-checkout paths before worktree creation and consumes them relative to the worktree.
- `v2/docs/write-behavior.md` — document existence, symlink-resolution, resolved-root containment, non-index artifact handling, and pre-daemon failure semantics.
- `v2/docs/v1-behaviors.md` — record the corrected v2 first-launch and path-validation behavior.
