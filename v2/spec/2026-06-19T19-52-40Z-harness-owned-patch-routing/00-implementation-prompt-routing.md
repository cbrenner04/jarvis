# Implementation prompt routing

## Problem

`getActiveLinkedSubspecPath` already selects the active subspec, but
`patch.prompt.body` still tells the agent to discover repo guidance and pick the
first unchecked index link. Implementation prompts pass only `index.md` as
`SPEC_PATH`, so the agent re-derives routing and may disagree with the harness.

## Decisions

- Harness owns subspec selection for normal implementation iterations via
  `getActiveLinkedSubspecPath`; the prompt states the resolved path and inlines
  the subspec body. Rules out agent-side index routing instructions.
- Remove `Pick the single most important unchecked task…` from
  `patch.prompt.body`. Rules out dual routing prose in the implementation
  template.
- Slim `patch.rules` `## Iteration`: drop the first-unchecked-link rule; keep
  tick/blocker/index-checkbox semantics unchanged. Rules out repeating harness
  routing in rules.
- Preload repo guidance from repo-root `AGENTS.md` and repo-root `CLAUDE.md`
  only when each file exists; omit missing files silently. Rules out
  discover-yourself guidance instructions and unbounded doc discovery in the
  prompt.
- Normal implementation prompts carry the active subspec only — not the full
  index-routed spec tree, not sibling subspec bodies, not `index.md` body beyond
  what the harness needs for path display. Rules out `buildSpecTree` on the
  implementation path.
- Direct non-index spec runs (`<spec-path>` is not `index.md`) inject that
  file as the active subspec body. Rules out index-routing instructions when
  the operator already passed a subspec path.
- `buildVerdictActuatorPrompt` shares `patch.prompt.body`; drop agent routing
  there too; the appended verdict section remains the task source. Rules out
  leaving the old pick-task line on the review-actuator path.
- Deferred to first consumer: fix-up prompt shape when the checklist is complete
  and `getActiveLinkedSubspecPath` is undefined — pin when aligning
  `buildFixupPrompt`.
- Bump `patch.prompt.body` revision when placeholders change; bump
  `patch.rules` revision when the iteration section changes; regenerate rendered
  fixtures per prompt governance. Rules out shipping stale snapshot fixtures.

## Tasks

- Extend `buildPrompt` (and `buildVerdictActuatorPrompt` call path) to accept
  harness-resolved active subspec path/body and a repo-guidance block assembled
  from repo-root `AGENTS.md` / `CLAUDE.md`.
- Wire `v1/src/modes/patch/run.ts` implementation iterations to pass
  `getActiveLinkedSubspecPath` output and read the active subspec file from the
  worktree.
- Update `prompts/patch/instructions.md`: replace discover-yourself + pick-task
  lines with delimited active-subspec and repo-guidance placeholders.
- Update `prompts/patch/rules.md` `## Iteration` per decisions; bump fragment
  revision.
- Update `v1/test/prompt.test.ts`, add focused tests proving the implementation
  prompt includes active subspec path/body and omits other subspec/index content
  and discover-yourself routing.
- Regenerate `patch.prompt.body` rendered fixtures and snapshot assertions.
- Update `v1/docs/run-loop.md` iteration section and add/adjust patch-routing
  entries in `v2/docs/v1-behaviors.md`.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] Normal index-routed implementation prompts name the harness-selected
      active subspec path and inline that subspec's full body; they do not
      instruct the agent to pick the first unchecked index link.
- [ ] Normal index-routed implementation prompts do not inline sibling subspec
      bodies, `index.md` checklist prose, or a full spec-tree dump.
- [ ] When repo-root `AGENTS.md` and/or `CLAUDE.md` exist, the implementation
      prompt inlines their contents in bounded preload sections; when absent, the
      prompt omits that section without error.
- [ ] The implementation prompt does not instruct the agent to discover repo
      guidance on its own.
- [ ] `prompts/patch/rules.md` no longer states that the active task is the
      first unchecked subspec link in `index.md`; tick/blocker/index-checkbox
      rules are otherwise preserved.
- [ ] `buildVerdictActuatorPrompt` output does not include pick-task or
      discover-yourself routing instructions.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` passes with regenerated
      `patch.prompt.body` fixtures reflecting the new template and slimmer
      rules body.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: replace discover-yourself / agent-routing iteration
  prose with harness-owned active-subspec injection and bounded repo-guidance
  preload.
- `v2/docs/v1-behaviors.md`: add/update patch-mode bullets recording harness
  subspec selection in implementation prompts, active-subspec-only context, and
  bounded `AGENTS.md` + root `CLAUDE.md` preload. Cite `v1/src/modes/patch/run.ts`,
  `v1/src/modes/patch/prompt.ts`, `prompts/patch/instructions.md`,
  `prompts/patch/rules.md`.

## Out of scope

- Review/shrink diff bounding (`01-review-shrink-diff-bounds.md`).
- Plan mode prompts.
- Fix-up iteration prompt shape beyond shared-template routing removal.
- Harness auto-tick or index checkbox flipping.
- Shared spec-parser extraction.
