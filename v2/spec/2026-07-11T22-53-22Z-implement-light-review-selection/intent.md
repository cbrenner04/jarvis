---
name: implement-light-review-selection
---

# Light review selection for implement

`jarvis run workflow implement` accepts `--review-behavior debate|light` and
uses its project default when omitted. Light review replaces the optional
debate step with the critic-actuator review primitive while preserving the
resolved selection in run metadata.

## Decisions

- `debate` is the default review behavior; rules out silently changing v1-parity runs to light review.
- CLI `--review-behavior` overrides the registered project's review default; rules out making the project setting unconditional.
- `light` emits `review` with `patch.prompt.review.critic` and the existing review actuator verdict path; rules out routing light selection through debate roles.
- `debate` continues to emit `review-debate` with `patch.prompt.review.*` and `verdict-patch.md`; rules out behavior-specific alias presets.
- Resolved `reviewBehavior` is retained in run metadata exposed to list/TUI consumers; rules out showing only an unresolved config source.

## Scope

- Add behavior flag parsing, validation, project-default resolution, and metadata propagation for implement runs.
- Select the loaded light or debate review step when resolved review passes are positive.
- Add `patch.prompt.review.critic` for the light critic path.
- Document review-behavior selection and the project config schema in their v2 operator-doc homes.

## Prerequisites

- Implement runs support optional bounded debate review after linked subspec completion.
- Authored workflow loading supports review and review-debate role bindings.
- Review workflow dispatch executes bounded critic-actuator cycles.
