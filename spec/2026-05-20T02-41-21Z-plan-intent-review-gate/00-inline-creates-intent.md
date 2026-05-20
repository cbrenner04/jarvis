# 00 - Inline argument creates intent.md only

## Goal

`jarvis plan "one liner"` writes a new `intent.md` and exits. It does not run Phase 0, open a plan worktree for refinement, or continue into draft/review.

## Decisions

- One-shot authoring: quoted text becomes the initial `intent.md` body (rough is fine).
- No structure imposed on the file beyond what the operator adds manually later.
- Choosing spec directory / plan name may use existing naming helpers or a minimal default; the subspec should not require running the full plan pipeline.
- File-mode `jarvis plan path/to/intent.md` is a separate entry point (subspec 01).

## Task Checklist

- Implement or adjust plan CLI so inline invocation only creates/persists `intent.md` and returns.
- Ensure inline does not invoke Phase 0, draft, review, or plan-branch worktree setup for a full run.

## Acceptance criteria

- [ ] `jarvis plan "foo bar baz"` creates `intent.md` containing the supplied text and exits without running Phase 0.
- [ ] `jarvis plan path/to/spec/.../intent.md` is unchanged as the entry point for a full plan run (subspec 01).
- [ ] `docs/plan-mode.md` documents inline as intent authoring only and points operators to `jarvis plan <intent.md>` for the pipeline.

## Documentation updates

- Split input modes in `docs/plan-mode.md`: inline = draft intent file; file path = start plan from intent.
