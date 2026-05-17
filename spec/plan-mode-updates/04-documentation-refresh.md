# 04 - Documentation Refresh

## Problem

The behavior changes in this spec affect user-facing plan-mode workflow and spec-authoring conventions. Documentation needs to be updated after the implementation subspecs so future hand-written and plan-generated specs use the same conventions.

## Decisions

- Update `docs/spec-guidance.md` to require timestamped spec directory names for new specs.
- Update `docs/plan-mode.md` for:
  - timestamped spec directory paths,
  - quieter default CLI output,
  - revised successful next steps,
  - the current PR lifecycle after removing the ready-flip instruction from terminal output.
- Update `AGENTS.md` only if its spec-directory convention conflicts with the new timestamped-prefix rule.
- Do not rewrite old completed spec paths in docs except where they are examples of the old convention and would confuse new work.
- Keep examples consistent with the filesystem-safe timestamp format chosen in subspec 00.

## Tasks

- [ ] Update spec authoring guidance for timestamped directory prefixes.
- [ ] Update plan-mode docs for new paths and output.
- [ ] Update any CLI help text that describes plan output or resume commands.
- [ ] Review docs for stale "mark ready for review" wording and update where necessary.
- [ ] Add or update tests for generated help text if the project snapshots it.

## Acceptance criteria

- [ ] Documentation tells users to create new spec directories with a filesystem-safe ISO 8601 timestamp prefix.
- [ ] Plan-mode docs show timestamped `spec/.../index.md` paths for new plan specs.
- [ ] Plan-mode docs no longer tell users that the CLI next steps include a PR ready-flip instruction.
- [ ] Plan-mode output examples match the quieter default terminal output.
- [ ] Any CLI help text touched by the implementation is consistent with the docs.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- This subspec is the documentation update for the full plan-mode-updates spec tree.
