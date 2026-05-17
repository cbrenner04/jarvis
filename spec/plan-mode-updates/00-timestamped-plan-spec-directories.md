# 00 - Timestamped Plan Spec Directories

## Problem

Plan-generated spec directories currently use only the proposed spec name, such as `spec/aider-agent/`. Completed specs already show that date-only prefixes are not enough once multiple specs are created on the same day. New plan specs need a timestamped prefix so their creation order is visible and collisions are less likely.

## Decisions

- Plan mode should create spec directories as `spec/<timestamp>-<name>/`, where `<name>` is the existing validated kebab-case plan name.
- Use a filesystem-safe ISO 8601 UTC timestamp prefix: `YYYY-MM-DDTHH-mm-ssZ`.
- The timestamp is generated once per new plan invocation and reused consistently for:
  - the created `spec/<timestamp>-<name>/` directory,
  - paths printed in "Next steps",
  - PR body file references,
  - resume instructions emitted by plan mode.
- Keep branches and worktrees based on the human-readable name: `plan/<name>` and `.worktree/plan-<name>/`. Do not put timestamps in branch or worktree names unless needed for a collision suffix already handled by existing naming logic.
- Collision checks for `spec/<dir>/` should check the full timestamped directory. Existing checks for `.worktree/plan-<name>/` and `plan/<name>` branches remain name-based.
- `jarvis plan --resume spec/<timestamp>-<name>/index.md` must infer the same `<name>` needed to find `.worktree/plan-<name>/` and branch `plan/<name>`. The timestamp prefix is spec-directory metadata, not part of the branch/worktree name.
- Existing pre-timestamp specs remain supported for resume and implementation. Do not require migration.

## Tasks

- [ ] Add a helper for generating filesystem-safe ISO 8601 UTC prefixes.
- [ ] Update new plan creation to write `intent.md`, `index.md`, and subspecs under `spec/<timestamp>-<name>/`.
- [ ] Update resume path parsing so timestamped spec directories map back to `plan/<name>` and `.worktree/plan-<name>/`.
- [ ] Preserve compatibility with existing untimestamped plan spec directories.
- [ ] Add tests for new plan creation, collision handling, and resume path parsing.

## Acceptance criteria

- [ ] A new plan run creates spec files under `spec/YYYY-MM-DDTHH-mm-ssZ-<name>/`.
- [ ] Plan branch and worktree names remain `plan/<name>` and `.worktree/plan-<name>/`.
- [ ] `jarvis plan --resume spec/YYYY-MM-DDTHH-mm-ssZ-<name>/index.md` resumes the matching `plan/<name>` worktree.
- [ ] Existing untimestamped plan specs can still be resumed.
- [ ] Timestamped spec paths are used in user-facing next-step commands and PR body file references.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree. This subspec should only update inline help or command output text that must change with the implementation.
