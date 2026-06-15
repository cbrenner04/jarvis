# 00 — Spec-guidance PR-sized merge-unit rule

`v1/docs/spec-guidance.md` is the canonical home of the sizing rule and the only
place the numeric threshold lives. The doc is injected wholesale as
`SPEC_GUIDANCE` into every live plan prompt (draft, adversary, advocate,
adjudicator, actuator), so stating the rule here reaches all of them; subspecs
01/02 make the prompts act on it explicitly.

Today the "Subspecs" section says subspecs are atomic and independently
implementable/testable but says nothing about review size, so a subspec can be
atomic yet still bundle a whole program area into one un-reviewable PR.

## Decisions

- Numeric threshold lives only in `spec-guidance.md`. — rules out duplicating
  `1000` into prompt text (drift + violates plan-prompt-coherence principle).
- Frame the unit as "one independently mergeable PR-sized chunk," not "one
  commit." — rules out commit-sized checklist items inside one giant spec PR.
- ~1000 changed lines incl. tests/docs is a reviewability *warning*, not a hard
  cap. — rules out a mechanical line gate that blocks legitimately large slices.
- Split oversize subspecs along independently observable behavior; prefer
  vertical slices over umbrella subspecs (e.g. "daemon host + IPC + logs + run
  control"). — rules out splitting by layer/file, which yields un-mergeable
  fragments.

## Task checklist

- Extend the "Subspecs" section of `v1/docs/spec-guidance.md`: a subspec is one
  independently mergeable, PR-sized implementation chunk; ~1000 changed lines
  (incl. tests/docs) is a hard reviewability warning; split likely-oversize
  subspecs *before* implementation, along independently observable behavior;
  prefer vertical slices over umbrella subspecs.
- Record the new v1 planning behavior in `v2/docs/v1-behaviors.md`: spec-guidance
  now defines PR-sized merge units with a ~1000-line reviewability warning.

## Acceptance criteria

- [ ] `v1/docs/spec-guidance.md` states a subspec is one independently
      mergeable, PR-sized implementation chunk.
- [ ] `v1/docs/spec-guidance.md` names ~1000 changed lines (incl. tests/docs) as
      a reviewability warning and instructs splitting likely-oversize subspecs
      before implementation, along independently observable behavior, preferring
      vertical slices over umbrella subspecs.
- [ ] `1000` (or any numeric line threshold) appears in `v1/docs/spec-guidance.md`
      and in no file under `prompts/`.
- [ ] `v2/docs/v1-behaviors.md` records that spec-guidance defines PR-sized merge
      units with the ~1000-line reviewability warning.

## Documentation updates

- `v1/docs/spec-guidance.md` — the change itself.
- `v2/docs/v1-behaviors.md` — parity baseline entry.
