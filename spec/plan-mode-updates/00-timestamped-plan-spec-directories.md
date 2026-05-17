# 00 - Timestamped Plan Spec Directories

## Problem

Plan-generated spec directories currently use only the proposed spec name, such as `spec/aider-agent/`. Completed specs already show that date-only prefixes are not enough once multiple specs are created on the same day. New plan specs need a timestamped prefix so their creation order is visible, collisions are less likely, and generated specs follow the same convention expected of hand-written specs.

## Decisions

- Plan mode should create spec directories as `spec/<timestamp>-<name>/`, where `<name>` is the existing validated kebab-case plan name.
- Use a filesystem-safe ISO 8601 UTC timestamp prefix: `YYYY-MM-DDTHH-mm-ssZ`.
- Generate the prefix from a real UTC timestamp by replacing the `:` separators in `Date.prototype.toISOString()` with `-` and trimming milliseconds. Do not use local time.
- The timestamp is generated once per new plan invocation and reused consistently for:
  - the created `spec/<timestamp>-<name>/` directory,
  - the first line of each plan-mode spec commit body (`Spec: spec/<timestamp>-<name>/intent.md`),
  - paths printed in "Next steps",
  - PR body file references,
  - agent prompts and write-boundary checks,
  - resume instructions emitted by plan mode.
- Keep branches and worktrees based on the human-readable name: `plan/<name>` and `.worktree/plan-<name>/`. Do not put timestamps in branch or worktree names unless the existing branch/worktree collision logic already adds a suffix.
- Collision checks for the spec directory should check the full timestamped directory. Branch and worktree collisions remain name-based and continue to use the existing suffix behavior.
- `jarvis plan --resume spec/<timestamp>-<name>/index.md` must infer the same `<name>` needed to find `.worktree/plan-<name>/` and branch `plan/<name>`. The timestamp prefix is spec-directory metadata, not part of the branch/worktree name.
- Timestamp detection must be exact: strip a prefix only when the directory basename starts with `YYYY-MM-DDTHH-mm-ssZ-`. Names that merely contain hyphens or dates elsewhere must keep their full basename for branch/worktree lookup.
- Existing pre-timestamp specs remain supported for resume and implementation. Do not require migration.
- If a timestamped spec directory collides anyway, preserve the existing user-facing collision behavior by choosing the next available safe directory or failing with the current style of clear error; do not silently write into an existing spec tree.

## Tasks

- [ ] Add a helper for generating filesystem-safe ISO 8601 UTC prefixes.
- [ ] Update new plan creation to write `intent.md`, `index.md`, and subspecs under `spec/<timestamp>-<name>/`.
- [ ] Update all plan-mode path consumers to use the timestamped spec directory, including commit body `Spec:` lines, draft/review prompts, boundary validation, PR body rendering, and next-step output.
- [ ] Update resume path parsing so timestamped spec directories map back to `plan/<name>` and `.worktree/plan-<name>/`.
- [ ] Preserve compatibility with existing untimestamped plan spec directories.
- [ ] Add tests for timestamp formatting, new plan creation, collision handling, prompt/write-boundary paths, and resume path parsing.

## Acceptance criteria

- [ ] A new plan run creates spec files under `spec/YYYY-MM-DDTHH-mm-ssZ-<name>/`.
- [ ] Plan branch and worktree names remain `plan/<name>` and `.worktree/plan-<name>/`.
- [ ] `jarvis plan --resume spec/YYYY-MM-DDTHH-mm-ssZ-<name>/index.md` resumes the matching `plan/<name>` worktree.
- [ ] Existing untimestamped plan specs can still be resumed.
- [ ] Timestamp stripping only applies to an exact `YYYY-MM-DDTHH-mm-ssZ-` prefix.
- [ ] Timestamped spec paths are used in user-facing next-step commands, PR body file references, commit body `Spec:` lines, agent prompts, and write-boundary checks.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree. This subspec should only update inline help or command output text that must change with the implementation.
