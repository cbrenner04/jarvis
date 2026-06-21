# 00 - Add mid-edit red guidance to patch rules

## Problem

The patch agent misinterprets a red suite observed mid-edit (e.g. after snapshot
files are written but before dependent code is updated) as evidence of pre-existing
unrelated breakage, and raises a `## Blocker` on that basis. `prompts/patch/rules.md`
has no guidance covering this case.

## Decisions

- Add the guidance to the `## Stop` section of `prompts/patch/rules.md`, since that
  is where blocker-raising rules live; inserting it elsewhere would mis-categorize it.
- Guidance is three principles: mid-edit red is not pre-existing breakage; a blocker
  citing "baseline/pre-existing/unrelated failures" requires base-ref confirmation;
  finish edits and re-run before concluding the suite is broken.
- No harness changes — agent-side rules only, per the intent's out-of-scope clause.

## Acceptance criteria

- [ ] `prompts/patch/rules.md` contains guidance that a red suite observed before all edits are complete is not evidence of pre-existing breakage.
- [ ] `prompts/patch/rules.md` contains guidance that claiming "pre-existing / unrelated / baseline failures" as a blocker requires base-ref confirmation.
- [ ] `prompts/patch/rules.md` contains guidance to finish edits and re-run the suite before concluding it is broken.
