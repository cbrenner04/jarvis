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

- Add the rule under the existing `## Stop`/`## Iteration` rule set, not a new section — it's one more constraint, not a new behavior surface.
- Phrase as "do not create commits / run `git commit`; Jarvis owns staging and committing" — rules out a narrower "don't push" phrasing that leaves `git commit` ambiguous.
- Bump `revision:` 7 → 8 — the registry uses revision as the change-visible marker for snapshot keys; an edited body with a stale revision is the wrong alternative.

## Task checklist

- Add the no-self-commit rule to `prompts/patch/rules.md`, bump revision to 8.
- Assert the rendered patch prompt carries the guidance in `v1/test/prompt.test.ts`.
- Add a `v2/docs/v1-behaviors.md` entry; lift `patch.rules` revision citations that describe current behavior from 7 to 8.

## Acceptance criteria

- [ ] The agent-facing patch rules instruct the agent not to create commits (not to run `git commit`), stating Jarvis owns staging and committing.
- [ ] The rendered implementation prompt produced by `buildPrompt` includes the no-self-commit guidance, verified by a test in `v1/test/prompt.test.ts`.
- [ ] `prompts/patch/rules.md` carries `revision: 8`.
- [ ] `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: add an entry recording that the patch rules now instruct agents to leave all committing to Jarvis (revision 8), and update existing `patch.rules` revision citations that describe still-current behavior from revision 7 to 8.
