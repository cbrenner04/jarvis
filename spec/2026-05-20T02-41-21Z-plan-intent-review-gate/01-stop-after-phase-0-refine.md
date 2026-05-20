# 01 - Stop after Phase 0 intent refinement

## Goal

`jarvis plan path/to/spec/.../intent.md` runs Phase 0 on a fresh committed plan, then always stops with `## Blocker` and an intent-only draft PR. Phase 1 (draft) and review run only after `--resume-draft` (subspec 02).

Prerequisite: `intent.md` already exists (from inline draft, hand authoring, or copy).

## Decisions

- **Entry**: file path to `intent.md`, not inline quoted text (see subspec 00).
- **Phase boundary**: stop after full Phase 0 (`plan: refine` pushed), before Phase 1.
- **Universal**: every successful fresh committed file-based plan stops here.
- **Blocker**: feedback slot for the operator; agent may add guided questions (zero OK).
- **Mid–Phase 0 blocker**: if refine already stopped with `## Blocker`, keep current behavior.

## Task Checklist

- After Phase 0 on a fresh committed run, do not invoke draft.
- Ensure review-gate `## Blocker` before exit when Phase 0 completed without an earlier blocker.
- Reuse `plan: blocker`, intent-only PR, exit non-zero.

## Acceptance criteria

- [ ] `jarvis plan spec/<spec-dir>/intent.md` runs Phase 0 then exits before draft with `## Blocker` when no earlier Phase 0 blocker stopped the run.
- [ ] The resulting draft PR contains only the intent tree (no `index.md` or subspecs).
- [ ] Commits on first invocation include `plan: refine` and `plan: blocker` only (no `plan: draft` / `plan: review N`).
- [ ] `jarvis plan "inline text"` does not trigger this path (subspec 00).
- [ ] `docs/plan-mode.md` documents the file-path workflow and Phase 0 checkpoint.

## Documentation updates

- Document file-path plan lifecycle and Phase 0 stop in `docs/plan-mode.md`.
