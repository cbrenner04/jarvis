# Patch rules forbid agent self-commits

## Problem

The injected patch-mode rules (`prompts/patch/rules.md`) never tell the agent
that Jarvis owns committing. Some agents (e.g. haiku) run `git commit`
mid-subspec, interleaving agent-style commits with Jarvis completion commits and
raising blast radius. The commit-ownership contract is already documented in
`v1/docs/worktrees-and-commits.md` ("the agent should not run `git commit`
during a subspec") but is absent from the rules the agent actually receives.

This is guidance-only: it changes the text injected into the agent, not harness
commit handling. The harness must stay robust to a self-committing agent
regardless.

## Decisions

- Add the rule under `## Iteration` — it's a during-work "Jarvis owns this surface" constraint of the same shape as the existing "do not edit `index.md`; Jarvis flips the checkbox" rule, not a new section or a stop condition.
- Canonical sentence to add to `rules.md`: "Do not run `git commit` or otherwise create commits. Jarvis owns staging and committing." — rules out a narrower "don't push" phrasing that leaves `git commit` ambiguous.
- Bump `patch.rules` `revision:` 7 → 8 — the registry uses revision as the change-visible marker for snapshot keys; an edited body with a stale revision is the wrong alternative.
- Also bump `patch.prompt.body` `revision:` 6 → 7 — `rules.md` is embedded verbatim in the rendered prompt body, so its rendered content moves; the wrong alternative is regenerating the `@r6` fixtures in place, which mutates a historical snapshot key while leaving a stale revision and breaks the change-visible-marker contract.
- New test asserts a stable keyword (`git commit`), not full prose — the whole-body `toContain` already covers any new line mechanically, and an exact-prose assertion is brittle.

## Task checklist

- Add the canonical no-self-commit sentence to `prompts/patch/rules.md` under `## Iteration`, bump `revision:` to 8.
- Bump `patch.prompt.body` `revision:` 6 → 7 (`prompts/patch/instructions.md`).
- Regenerate the affected rendered-prompt fixtures: `patch.prompt.body@r7.shared.txt` and `patch.prompt.body@r7.wrapper.codex.exec.stdin+marker.txt`.
- Update `v1/test/prompts/rendered-snapshots.test.ts`: bump the `patch.prompt.body` revision assertion 6 → 7 (and the derived snapshot key).
- Assert the rendered patch prompt carries `git commit` guidance in `v1/test/prompt.test.ts`.
- Update `v2/docs/v1-behaviors.md`: add the new-behavior entry and bump the named `patch.rules` revision-7 citations to 8.

## Acceptance criteria

- [ ] The agent-facing patch rules instruct the agent not to create commits (not to run `git commit`), stating Jarvis owns staging and committing.
- [ ] The rendered implementation prompt produced by `buildPrompt` includes the no-self-commit guidance, verified by a test in `v1/test/prompt.test.ts` asserting the stable keyword `git commit`.
- [ ] `prompts/patch/rules.md` carries `revision: 8` and `prompts/patch/instructions.md` (`patch.prompt.body`) carries `revision: 7`.
- [ ] The `patch.prompt.body` rendered-prompt fixtures (shared and codex-exec wrapper) are regenerated and `rendered-snapshots.test.ts` asserts revision `7`.
- [ ] `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: add an entry recording that the patch rules now instruct agents to leave all committing to Jarvis (revision 8). Bump every `patch.rules` revision-7 citation to 8 — the four `(revision 7)` occurrences: line 73 Sources, line 109 inline `, revision 7)` and its Sources `(revision 7)`, and line 110 — both the `(revision 7)` token inside the bold heading and the Sources `(revision 7)`. The bare `prompts/patch/rules.md` citations that carry no revision token (e.g. line 35, line 388) stay as-is.
