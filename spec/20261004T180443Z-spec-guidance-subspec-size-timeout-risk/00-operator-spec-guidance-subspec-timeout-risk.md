# 00 — Operator spec-guidance subspec timeout-risk bullet

## Problem

Implement runs hit the 45-minute iteration wall mid-subspec while still making progress when a subspec bundles a large single-file rewrite or an unbounded touched-file list; operator guidance does not yet call out that sizing hazard.

## Decisions

- Add one terse operator bullet in `docs/spec-guidance.md` only — rules out duplicating the warning in `docs/spec-guidance-agent-core.md` (agents already have commit-sized / atomic subspec contracts there).
- Introduce a dedicated `## Subspec sizing and iteration timeout` section immediately after `## Land the spec before implementing it` — rules out tucking the warning only under seed `effort: high` or plan review prose where operators drafting subspecs may not see it before implement dispatch.
- The bullet covers both triggers in one sentence: rewriting more than a few hundred lines in one file, or an open-ended touched-file list — rules out two separate sections or bullets that let authors satisfy only one half of the hazard pattern.
- The bullet requires split or explicit sizing before implement dispatch — rules out advisory “consider splitting” wording that does not block oversize subspecs at authoring time.

## Tasks

- [ ] Add `## Subspec sizing and iteration timeout` to `docs/spec-guidance.md` with one bullet stating the timeout hazard and the split-or-size requirement.

## Acceptance criteria

- [x] `docs/spec-guidance.md` contains `## Subspec sizing and iteration timeout` and prose that a subspec rewriting more than a few hundred lines in one file, or with an open-ended touched-file list, is an implement iteration-timeout hazard and must be split or explicitly sized before implement dispatch.
- [x] `bun run lint:md` passes.

## Documentation updates

- `docs/spec-guidance.md` — subspec sizing / iteration-timeout bullet per intent.
