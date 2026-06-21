# 00 - Add mid-edit red guidance to patch rules

## Problem

The patch agent misinterprets a red suite observed mid-edit (e.g. after snapshot
files are written but before dependent code is updated) as evidence of pre-existing
unrelated breakage, and raises a `## Blocker` on that basis. `prompts/patch/rules.md`
has no guidance covering this case.

## Decisions

- All three principles go into the `## Stop` section of `prompts/patch/rules.md`, not split between `## Stop` and `## Iteration`, because the failure mode is an incorrectly-raised blocker; `## Iteration`'s "re-run" discipline is incidental context, not the primary signal to add.
- Qualify the existing `## Stop` "Repeated failure" line so it applies only after edits are complete — as written it would let an agent classify mid-edit red as repeated failure and stop, the exact failure mode this spec targets.
- AC #2 is a prohibition, not a git procedure: the agent must not raise a "pre-existing / unrelated / baseline failures" blocker on a mid-edit red; the harness validates such claims against the base ref and will reject an unconfirmed one.
- Added text is terse imperative bullets matching the style of neighboring lines — no prose sentences.
- Bump `revision:` frontmatter from 3 to 4; editing the body without bumping breaks an observable convention.
- `v2/docs/v1-behaviors.md` update not required: the catalog tracks harness/runtime behavior; this change is prompt-only with no runtime change.
- No harness changes — agent-side rules only, per the intent's out-of-scope clause.

## Acceptance criteria

- [ ] `prompts/patch/rules.md` `## Stop` section contains a bullet that a red suite observed before all edits are complete is not evidence of pre-existing breakage.
- [ ] `prompts/patch/rules.md` `## Stop` section contains a bullet prohibiting a "pre-existing / unrelated / baseline failures" blocker on a mid-edit red (the harness validates such claims and will reject an unconfirmed one).
- [ ] `prompts/patch/rules.md` `## Stop` section contains a bullet to finish edits and re-run before concluding the suite is broken.
- [ ] The `## Stop` "Repeated failure" line is qualified to apply only after edits are complete.
- [ ] `prompts/patch/rules.md` `revision:` frontmatter is bumped to 4.
