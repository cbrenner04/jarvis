# 01 — Draft prompt sizes subspecs

The plan draft step (`prompts/plan/draft.md`, id `plan.prompt.draft`) tells the
agent to produce "one or more atomic subspecs" but gives no sizing constraint,
so it can emit an atomic-but-oversized subspec that bundles a program area into
one un-reviewable PR. Make the draft agent apply the PR-sizing/split rule from
00 while decomposing.

Depends on 00 (the rule it references must exist in `spec-guidance.md`, which is
injected as `SPEC_GUIDANCE` into this prompt).

## Decisions

- Reference the sizing rule from the injected spec guidance; do not restate the
  number. — rules out hardcoding `1000` into prompt text.
- Constraint applies during decomposition (split before writing), not as a
  post-hoc check. — rules out drafting umbrella subspecs and trimming later,
  which the shrink step already cannot fix.
- Touch only the draft surface here. — review surfaces are 02; keeps each a
  separate mergeable PR.

## Task checklist

- Edit `prompts/plan/draft.md`: instruct the agent to shape subspecs as
  independently mergeable PR-sized chunks per the spec guidance's sizing rule —
  prefer vertical slices, split a likely-oversize subspec along independently
  observable behavior before writing it.
- Bump the `revision` in `prompts/plan/draft.md` frontmatter and add the matching
  `plan.prompt.draft@r<n>.shared.txt` rendered snapshot under
  `v1/test/fixtures/prompts/rendered/`.
- Record in `v2/docs/v1-behaviors.md`: the plan draft prompt decomposes intents
  into PR-sized subspecs and splits likely-oversize ones.

## Acceptance criteria

- [ ] `prompts/plan/draft.md` instructs the draft agent to shape subspecs as
      independently mergeable PR-sized chunks, preferring vertical slices and
      splitting likely-oversize subspecs along independently observable behavior
      before writing them.
- [ ] `prompts/plan/draft.md` references the spec-guidance sizing rule rather
      than stating any numeric line threshold.
- [ ] `prompts/plan/draft.md` `revision` is bumped and the matching rendered
      snapshot fixture exists; `bun test` passes (registry, renderer, snapshot
      tests).
- [ ] `v2/docs/v1-behaviors.md` records that the plan draft prompt produces
      PR-sized subspecs and splits likely-oversize ones.

## Documentation updates

- `prompts/plan/draft.md` — the prompt change (governed artifact).
- `v2/docs/v1-behaviors.md` — parity baseline entry.
