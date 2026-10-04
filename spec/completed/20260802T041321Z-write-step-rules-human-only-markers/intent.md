---
name: write-step-rules-human-only-markers
---

# Plan and implement write-step rules state human-only marker placement

## Problem

Plan agents write `(Manual)` leading the bullet; implement agents inherit the same gap. Nothing in
injected `spec-guidance` or `DEFAULT_WRITE_STEP_RULES` names accepted markers or states that
placement within a criterion is free, so drafts depend on undocumented trailing/first-line
anchoring the parser no longer uses.

## Decisions

- Name accepted markers and free placement in `v1/docs/spec-guidance.md` (plan draft injection)
  and `DEFAULT_WRITE_STEP_RULES` (`shared/prompts/step-rules.ts`, implement path) — rules out
  parser-only fixes with silent prompts.
- Rendered-prompt tests pin both surfaces separately — rules out `toContain(DEFAULT_WRITE_STEP_RULES)`
  alone without substring pins for marker vocabulary and placement freedom.

## Acceptance criteria

- [ ] The plan and implement write-step rules name the accepted human-only markers and state that
      placement within the criterion is free; a rendered-prompt test pins that text on
      `plan.prompt.draft` (spec-guidance injection) and `patch.prompt.body` (stepRules).
- [ ] `bun run typecheck`, `bun run test:v1`, and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — accepted human-only markers and that placement within a criterion
  is free (replace trailing-anchor wording in `#### Human-only acceptance criteria`).

## Prerequisites

- `parseSpec` assembles each acceptance criterion from its full bullet block (first checklist line plus continuation lines until the next `- [ ]` / `- [x]` or section heading).
- `(Manual)`, `visual inspection only`, and `no automated guard` classify a criterion as human-only when present anywhere in that assembled text (case-insensitive, whole-phrase).
