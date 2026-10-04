# Resolve implement launch inputs

Make `implement` resolve its project, default branch, and index artifact from `--spec` rather than invocation location or a manual artifact.

## Decisions

- Resolve the registered project from `--spec`, not caller cwd; rules out starting against an unrelated registered checkout.
- Resolve a relative `--spec` against invocation cwd before lookup or branch derivation, not after worktree creation; rules out path-spelling-dependent launches.
- Recognize an index spec only when the resolved spec path is named `index.md`, not from its checklist content; rules out content-dependent CLI behavior.
- Fail before daemon contact when the resolved spec path is outside registered project roots, not by falling back to cwd; rules out an unrelated project launch.
- Default an omitted branch to the resolved spec path parent's basename, not a shared implementation default; rules out branch collisions between spec runs.
- Translate resolved spec and index-artifact paths to implementation-worktree-relative inputs, not source-checkout paths; rules out executing against the source checkout.
- Treat an index spec itself as the completion artifact and ignore supplied `--artifact`, not reject the flag; rules out breaking callers that still pass it.
- Deferred to first consumer: non-index `--artifact` compatibility — pin when a caller needs it.
- Keep `--base` required; rules out silently choosing a base ref beyond this launch-resolution change.

## Tasks

- Require `--spec` and `--base`; make `--branch` optional and `--artifact` optional only for resolved `index.md` specs.
- Resolve project identity/root, branch, and worktree-relative step paths before daemon connection.
- Preserve explicit branches; ignore index `--artifact`; keep non-index `--artifact` required.
- Cover CLI dispatch, early failures, and built workflow-step inputs.
- Align operator documentation.

## Acceptance criteria

- [x] `jarvis run workflow implement --base <ref> --spec <index>` launched outside the target checkout resolves the registered project containing the resolved spec path and starts its workflow.
- [x] A relative `--spec` resolves from invocation cwd; its parent basename supplies an omitted branch, while an explicit branch is unchanged.
- [x] A resolved `index.md` launch succeeds without `--artifact`; a supplied value is ignored and both spec and completion artifact reach the workflow as worktree-relative index paths.
- [x] A non-index launch still requires `--artifact`; a resolved spec outside registered project roots fails with a spec-path-specific error before daemon contact.
- [x] CLI and implement-workflow-step tests cover required `--spec`/`--base`, optional `--branch`, index-only optional `--artifact`, project identity/root, and worktree-relative workflow inputs.
- [x] `v2/docs/write-behavior.md` and `v2/docs/first-workflow-walkthrough.md` state that workflow-started implement runs cannot be paused or killed live.

## Documentation updates

- Update `v2/docs/write-behavior.md` with spec-path resolution, branch derivation, index-only optional `--artifact`, the v2 breaking CLI change, and workflow live-control limitation.
- Update `v2/docs/first-workflow-walkthrough.md` to launch `implement` without manual `--artifact` and state its live-control limitation.
- Update `v2/docs/v1-behaviors.md` with the changed implement-launch behavior.
