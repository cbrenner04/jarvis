---
name: implement-optional-debate-review
---

# Optional debate review for implement

`jarvis run workflow implement` accepts `--review-passes <n>` and resolves a
project default when the flag is absent. Zero keeps the existing implement
workflow; a positive value appends one bounded debate review after every linked
subspec is complete.

## Decisions

- `--review-passes 0` emits no authored review step; rules out an `implement-reviewed` preset.
- Positive passes append one `review-debate` step only after the linked index has zero unchecked acceptance criteria; rules out reviewing a partial implement run.
- Absent `--review-passes` resolves from the registered project's review default, with the CLI value winning; rules out a global-only or CLI-only setting.
- Debate review uses the existing `patch.prompt.review.*` role prompts and `verdict-patch.md`; rules out a new debate prompt family.
- Resolved `reviewPasses` is retained in run metadata exposed to list/TUI consumers; rules out losing the operator's effective selection after launch.

## Scope

- Add the implement CLI flag, validation, project-default resolution, and metadata propagation.
- Build either the current write workflow or write plus a loaded `review-debate` step.
- Keep the existing hidden shrink behavior before any appended review.
- Document the implement review-passes flag and project config schema in their v2 operator-doc homes.

## Prerequisites

- Registered-project implement workflow launch resolves a spec index through all linked subspecs.
- Authored workflow loading supports review-debate role bindings.
- Review-debate workflow dispatch executes bounded debate cycles.
