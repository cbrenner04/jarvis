# Resolve implement launch inputs

Make the `implement` workflow derive its registered project, default branch, and index completion artifact from `--spec`, so invocation location and manual artifact selection no longer affect an index-spec run.

## Decisions

- Resolve the registered project from `--spec`, not caller cwd; rules out starting against an unrelated registered checkout.
- Default an omitted branch to the basename of the spec file's parent directory, not a shared implementation default; rules out branch collisions between spec runs.
- Treat an index spec itself as the completion artifact and ignore supplied `--artifact`, not reject the flag; rules out breaking callers that still pass it.
- Deferred to first consumer: non-index `--artifact` compatibility — pin when a caller needs it.
- Keep `--base` required; rules out silently choosing a base ref beyond this launch-resolution change.

## Tasks

- Parse `implement` launch flags with optional `--branch` and `--artifact`.
- Derive project, branch, and index artifact before building the workflow step.
- Preserve explicit branches and defer non-index artifact semantics.
- Cover CLI dispatch and built workflow-step inputs.
- Align operator documentation.

## Acceptance criteria

- [ ] `jarvis run workflow implement --spec <index>` invoked outside the target checkout resolves the registered project containing that spec and starts its workflow.
- [ ] With no `--branch`, the workflow branch equals the spec file parent's basename; an explicit `--branch` is unchanged.
- [ ] An index-spec launch succeeds without `--artifact`; a supplied `--artifact` does not change the index completion artifact.
- [ ] CLI and implement-workflow-step tests cover spec-path resolution, branch derivation, and index artifact flag behavior.

## Documentation updates

- Update `v2/docs/write-behavior.md` with spec-path project resolution, branch derivation, optional index artifact behavior, and the v2 breaking CLI change.
- Update `v2/docs/first-workflow-walkthrough.md` to launch `implement` without manual `--artifact`, including any workflow-specific monitoring limitation needed by the changed command.
