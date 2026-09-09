# 02 - Documentation

## Problem

Durable docs and the plan prompt describe a post-hoc surface split that subspecs 00 and 01 retire. `prompts/plan/draft.md:56` frames the bullet rule in module-boundary-surface terms and claims a multi-surface bullet blocks the draft; `v2/docs/spec-guidance.md` and `v2/docs/write-behavior.md` describe the plan write path in terms that include draft re-splitting. Left unchanged, an agent is instructed against a contract that no longer exists — the same overclaiming that let an inert guard ship earlier in this corpus.

## Decision ledger

- Docs describe the shipped behaviour: the plan agent authors subspecs, the draft is validated but not re-split, and the bullet rule is one artifact per bullet; rules out leaving aspirational prose that no code enforces.
- Record that the retired taxonomy was jarvis-specific and applied to every registered project, so future operators understand why a product repo's plan drafts changed shape; rules out a silent behaviour change for other projects.
- No new doc file; update the existing homes; rules out a parallel narrative.

## Task checklist

- [ ] Update `prompts/plan/draft.md`'s bullet rule.
- [ ] Update `v2/docs/spec-guidance.md` and `v2/docs/write-behavior.md`.
- [ ] Record the change in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `prompts/plan/draft.md` states the bullet rule as one artifact per bullet, and contains no "module-boundary surface" framing or claim that a multi-surface bullet blocks the draft.
- [x] `v2/docs/spec-guidance.md` states that the plan agent authors subspecs and that no post-hoc surface split runs.
- [x] `v2/docs/write-behavior.md` describes the plan write path as validating the authored draft without re-splitting it.
- [x] `v2/docs/v1-behaviors.md` records the retirement, including that the taxonomy was jarvis-specific and previously applied to every registered project.
- [x] `bun run lint:md` passes.

## Documentation updates

- `prompts/plan/draft.md`, `v2/docs/spec-guidance.md`, `v2/docs/write-behavior.md`, `v2/docs/v1-behaviors.md` — as above.
