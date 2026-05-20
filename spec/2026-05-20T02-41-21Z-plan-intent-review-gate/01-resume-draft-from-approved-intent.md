# 01 - Resume draft from approved intent

## Goal

Add an explicit pre-draft resume entry point that continues an approval-gated committed plan run from `intent.md` into draft and review after the human has cleared the blocker.

## Decisions

- The new entry point is explicit: `jarvis plan --resume-draft spec/<spec-dir>/intent.md`.
- Ordinary `jarvis plan <intent.md>` remains fresh authoring input. It must not become context-sensitive based on existing plan worktrees.
- `--resume-draft` supports only committed plan mode (`modes.plan.commit: true`) in this first cut.
- Approval is represented by editing `intent.md` to remove or resolve the blocker before resume. If `## Blocker` is still present, resume fails.
- `--resume-draft` is additive. Normal `--resume` stays index-based and post-draft only.
- `computeResumeCounters()` stays shared so review numbering continues from existing `plan: review N` commits without special-case math.
- The implementation should extend the existing resume preparation seam with a sibling intent-based helper instead of making ordinary `--resume` polymorphic over both `index.md` and `intent.md`.

## Task Checklist

- Extend argument parsing and usage text with `--resume-draft`.
- Add a sibling preflight/helper path that validates `intent.md`, derives `plan/<name>` from the spec directory basename, and reuses the existing worktree/branch cleanliness checks without weakening ordinary `--resume`.
- Reject resume when `intent.md` still contains `## Blocker`.
- Run the normal draft phase, then the configured review passes, against the existing plan branch and PR.
- Preserve existing commit subjects and PR-body updates: `plan: draft` followed by `plan: review N`, with ready-marking on success.
- Update `docs/plan-mode.md` so the manual approval step and resume command are documented with the post-refine workflow.

## Acceptance criteria

- [ ] `jarvis plan --resume-draft spec/<spec-dir>/intent.md` is accepted as a distinct command shape, while plain `jarvis plan spec/<spec-dir>/intent.md` continues to mean fresh authoring input.
- [ ] `--resume-draft` validates the committed-plan preconditions needed for the existing branch/worktree flow and reuses the untimestamped `plan/<name>` plus `.worktree/plan-<name>/` mapping derived from `<spec-dir>`.
- [ ] `--resume-draft` exits with a clear validation error if `intent.md` still contains `## Blocker`; it does not auto-delete, reinterpret, or bypass the blocker.
- [ ] After the blocker is cleared, `--resume-draft` runs draft plus the configured review passes, reuses the existing draft PR, and leaves draft/review commit numbering and PR attribution behavior consistent with the current committed plan flow.
- [ ] Ordinary `--resume spec/<spec-dir>/index.md` behavior is unchanged and does not start accepting `intent.md` or sharing a context-sensitive dispatcher with `--resume-draft`.
- [ ] CLI-facing help and `docs/plan-mode.md` explain the manual approval step, the `--resume-draft spec/<spec-dir>/intent.md` command, and the first-cut bounds: no typed blockers, no automatic blocker clearing, and no `modes.plan.commit: false` support.

## Documentation updates

- Document the manual approval step, the `--resume-draft spec/<spec-dir>/intent.md` command, how it differs from ordinary `--resume`, and the first-cut scope limits in `docs/plan-mode.md`.
