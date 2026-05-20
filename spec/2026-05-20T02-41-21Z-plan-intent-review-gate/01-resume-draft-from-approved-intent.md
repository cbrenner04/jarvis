# 01 - Resume draft from approved intent

## Goal

Add an explicit pre-draft resume command that continues an approval-gated plan run from `intent.md` into draft and review after the human has cleared the blocker.

## Decisions

- The new entry point is explicit: `jarvis plan --resume-draft spec/<spec-dir>/intent.md`.
- Ordinary `jarvis plan <intent.md>` remains fresh authoring input. It must not become context-sensitive based on existing plan worktrees.
- `--resume-draft` supports only committed plan mode (`modes.plan.commit: true`) in this first cut.
- Approval is represented by editing `intent.md` to remove or resolve the blocker before resume. If `## Blocker` is still present, resume fails.
- `computeResumeCounters()` stays shared so review numbering continues from existing `plan: review N` commits without special-case math.
- Normal `--resume` remains index-based and post-draft only.

## Task Checklist

- Extend argument parsing and usage text with `--resume-draft`.
- Add a sibling preflight/helper path that validates `intent.md`, derives `plan/<name>` from the spec directory basename, and reuses the existing worktree/branch cleanliness checks.
- Reject resume when `intent.md` still contains `## Blocker`.
- Run the normal draft phase, then the configured review passes, against the existing plan branch and PR.
- Preserve existing commit subjects and PR-body updates: `plan: draft` followed by `plan: review N`, with ready-marking on success.

## Acceptance criteria

- [ ] `jarvis plan --resume-draft spec/<spec-dir>/intent.md` is accepted as a distinct command shape, while plain `jarvis plan spec/<spec-dir>/intent.md` continues to mean fresh authoring input.
- [ ] `--resume-draft` validates the committed-plan preconditions needed for the existing branch/worktree flow and reuses the untimestamped `plan/<name>` plus `.worktree/plan-<name>/` mapping derived from `<spec-dir>`.
- [ ] `--resume-draft` exits with a clear validation error if `intent.md` still contains `## Blocker`; it does not auto-delete, reinterpret, or bypass the blocker.
- [ ] After the blocker is cleared, `--resume-draft` runs draft plus the configured review passes, reuses the existing draft PR, and leaves draft/review commit numbering and PR attribution behavior consistent with the current plan flow.
- [ ] Ordinary `--resume spec/<spec-dir>/index.md` behavior is unchanged and does not start accepting `intent.md`.

## Documentation updates

- Document the manual approval step and the `--resume-draft spec/<spec-dir>/intent.md` command in `docs/plan-mode.md`.
