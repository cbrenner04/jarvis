---
name: intent-landing-accepts-no-prerequisites
---

# Intent landing refuses a ready-intent whose Prerequisites section says "none"

## Problem

The intent landing validator (`shared/intent-stage.ts:251`) requires `## Prerequisites` to be bullets and refuses `must list prerequisites as one bullet per line` when the section body is prose such as `none`. Split drafts write `none` for an independent intent. The refusal is not reprompted into a fix: the review row settled `landing_failed`, `run resume` replayed the same refusal (`internal_error`), and the pipeline went terminal `failed`. Removing the section by hand then tripped staged markdown lint (MD012 blank lines) twice before landing succeeded; the pipeline itself could not continue (`pipeline resume` refused on the now-ready intent PR) and was finished as standalone workflows.

## Evidence (2026-09-14)

Pipeline `d1fac88a` (`project-spec-home-is-one-knob-default-external`): review row `d2ce958d` `landing_failed`; `.jarvis-intent-stage/project-specs-config-key.md` had `## Prerequisites\n\nnone`. Landed after hand-edit as [#3911](https://github.com/cbrenner04/jarvis/pull/3911).

## Decisions

- A Prerequisites section whose body is empty or a single `none`/`None.` line means no prerequisites; landing normalises it (drops the section) instead of refusing.
- Other prose bodies still refuse, and the refusal is fed to the in-loop landing reprompt rather than settling immediately.

## Acceptance criteria

- [ ] A test proves a ready-intent with `## Prerequisites` body `none` lands with the section removed and passes staged markdown lint; it fails against the pre-fix refusal.
- [ ] A test proves a prose (non-`none`) Prerequisites body is still refused and triggers the landing reprompt.

## Documentation updates

- `v2/docs/spec-guidance.md` — ready-intent Prerequisites: omit or `none` for independent intents.
