# 02 - Document approval-gated plan flow

## Goal

Make the approval-gated plan workflow discoverable in CLI help and plan-mode docs, including the new stop point between refinement and drafting.

## Decisions

- The docs should describe this as an opt-in refinement checkpoint, not a general typed-blocker system.
- Examples should use the timestamped `spec/<spec-dir>/...` form and show the two-step operator flow:
  `jarvis plan --require-intent-approval ...` then, after editing `intent.md` to clear the blocker, `jarvis plan --resume-draft spec/<spec-dir>/intent.md`.
- Existing no-blocker and ordinary `--resume` flows should stay documented as separate paths.

## Task Checklist

- Update plan command usage/help text to include the new flags.
- Update `docs/plan-mode.md` sections covering flags, stop conditions, PR lifecycle, and next steps to explain the approval gate and resume path.
- Clarify that the draft PR may temporarily contain only `intent.md` plus blocker commits before any `index.md` exists.
- Clarify that this first cut does not support `modes.plan.commit: false`.

## Acceptance criteria

- [ ] CLI-facing usage/help text mentions both `--require-intent-approval` and `--resume-draft`.
- [ ] `docs/plan-mode.md` explains when the approval blocker is synthesized, how a reviewer clears it, and how `--resume-draft` differs from ordinary `--resume`.
- [ ] The docs state that approval-gated runs can open or update a draft PR before `index.md` exists, reusing the existing blocker PR lifecycle.
- [ ] The docs explicitly bound the first cut: no typed blockers, no automatic blocker clearing, and no `commit: false` support for `--resume-draft`.

## Documentation updates

- This subspec is itself the documentation pass; update any cross-references in `docs/spec-guidance.md` or related plan-mode docs only if the new workflow would otherwise read incorrectly.
