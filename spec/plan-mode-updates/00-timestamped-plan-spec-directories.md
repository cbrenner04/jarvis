# 00 - Timestamped Plan Spec Directories

## Problem

Plan-generated spec directories currently use only the proposed spec name, such as `spec/aider-agent/`. Completed specs already show that date-only prefixes are not enough once multiple specs are created on the same day. New plan specs need a timestamped prefix so their creation order is visible, collisions are less likely, and generated specs follow the same convention expected of hand-written specs after the documentation refresh in this spec tree.

## Decisions

- Plan mode should create spec directories as `spec/<timestamp>-<plan-name>/`, where `<plan-name>` is the final validated kebab-case plan name after existing name-collision suffixing.
- Use a filesystem-safe ISO 8601 UTC timestamp prefix: `YYYY-MM-DDTHH-mm-ssZ`.
- Generate the prefix from a real UTC timestamp by replacing the `:` separators in `Date.prototype.toISOString()` with `-` and trimming milliseconds. Do not use local time.
- Introduce separate internal concepts for the branch/worktree identity and the spec directory basename. For example, if the plan name is `aider-agent`, the branch remains `plan/aider-agent` while files live under `spec/2026-05-16T22-14-03Z-aider-agent/`.
- The timestamp is generated once per new plan invocation and reused consistently for:
  - the created `spec/<timestamp>-<plan-name>/` directory,
  - the first line of each plan-mode spec commit body (`Spec: spec/<timestamp>-<plan-name>/intent.md`),
  - paths printed in "Next steps",
  - PR body file references,
  - agent prompts and write-boundary checks,
  - `.active-spec-path` or any equivalent worktree marker used by triage/resume,
  - resume instructions emitted by plan mode.
- Keep branches and worktrees based on the final human-readable plan name: `plan/<plan-name>` and `.worktree/plan-<plan-name>/`. Do not put timestamps in branch or worktree names.
- Preserve the existing name-collision suffix behavior before adding the timestamp. If `aider-agent` collides, the final plan name should still become `aider-agent-2`, and the spec directory should be `spec/<timestamp>-aider-agent-2/`.
- Collision checks for branch and worktree names remain name-based. Collision checks for the spec directory should check the full timestamped basename after the final plan name is known.
- `jarvis plan --resume spec/<timestamp>-<plan-name>/index.md` must infer the same `<plan-name>` needed to find `.worktree/plan-<plan-name>/` and branch `plan/<plan-name>`. The timestamp prefix is spec-directory metadata, not part of the branch/worktree name.
- Timestamp detection must be exact: strip a prefix only when the directory basename starts with `YYYY-MM-DDTHH-mm-ssZ-`. Names that merely contain hyphens or dates elsewhere must keep their full basename for branch/worktree lookup.
- Existing pre-timestamp specs remain supported for resume and implementation. Do not require migration.
- If a timestamped spec directory collides anyway, preserve the existing user-facing collision behavior by choosing the next available safe directory or failing with the current style of clear error; do not silently write into an existing spec tree.
- Avoid broad renames of unrelated patch-mode spec handling. The path split is plan-mode specific, although shared helpers may be extracted if that is the smallest clean implementation.

## Tasks

- [ ] Add a helper for generating filesystem-safe ISO 8601 UTC prefixes.
- [ ] Add or update a helper that strips an exact timestamp prefix from a spec directory basename to recover the plan name for resume.
- [ ] Split plan-mode state so functions can receive both the final plan name and the timestamped spec directory basename where needed.
- [ ] Update new plan creation to write `intent.md`, `index.md`, and subspecs under `spec/<timestamp>-<plan-name>/`.
- [ ] Update all plan-mode path consumers to use the timestamped spec directory, including commit body `Spec:` lines, draft/review prompts, boundary validation, PR body rendering, active-spec markers, triage-visible paths, and next-step output.
- [ ] Update resume path parsing so timestamped spec directories map back to `plan/<name>` and `.worktree/plan-<name>/`.
- [ ] Preserve compatibility with existing untimestamped plan spec directories.
- [ ] Add tests for timestamp formatting, timestamp stripping, new plan creation, collision suffixing, prompt/write-boundary paths, active-spec markers, and resume path parsing.

## Acceptance criteria

- [ ] A new plan run creates spec files under `spec/YYYY-MM-DDTHH-mm-ssZ-<name>/`.
- [ ] Plan branch and worktree names remain `plan/<name>` and `.worktree/plan-<name>/`.
- [ ] Existing branch/worktree collision suffixing still applies to `<name>` before the timestamped directory basename is formed.
- [ ] `jarvis plan --resume spec/YYYY-MM-DDTHH-mm-ssZ-<name>/index.md` resumes the matching `plan/<name>` worktree.
- [ ] Existing untimestamped plan specs can still be resumed.
- [ ] Timestamp stripping only applies to an exact `YYYY-MM-DDTHH-mm-ssZ-` prefix.
- [ ] Timestamped spec paths are used in user-facing next-step commands, PR body file references, commit body `Spec:` lines, agent prompts, active-spec markers, and write-boundary checks.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree. This subspec should only update inline help or command output text that must change with the implementation.
