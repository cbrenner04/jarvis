---
name: artifact-count-exempts-references-and-rules-out-clauses
---

# The one-artifact-per-bullet check refuses bullets that merely reference a second file

## Problem

`assertSingleArtifactBullets` (`shared/module-boundary-surfaces.ts:78`) counts every backticked path in a plan bullet via `referencedArtifactPaths` and refuses when there are two or more, unless the bullet uses preservation or "the same"/"identical" wording with no build verb. Two shapes that current plan drafts write routinely are neither built artifacts nor exempt: a Decisions **rules-out clause** naming the alternative it rejects ("rules out duplicating the resolver inside `session-log.ts`"), and an acceptance criterion naming a **test file plus the module it covers** ("its test in `test/real-home-guard.test.ts` … `test/real-home-guard.ts`"). #3741 intended "count artifacts a bullet builds, not paths it mentions", but only preservation/shared wording is recognised as mention. The in-loop draft reprompt did not repair any instance, so each became an operator hand-edit or hand-land.

## Evidence (2026-09-14)

Four refusals across two plan lanes, all sound drafts:

- `session-logs-honor-jarvis-home` (pipeline `25784a7e`) failed three times in succession under `pipeline recover`, one bullet per attempt: a rules-out clause naming `session-log.ts`; "`v2/src/paths.ts` re-exports `jarvisHome` from `shared/paths.ts`"; then an AC naming `shared/jarvis-home-structural-guard.test.ts` with `shared/paths.ts` and `shared/invocation/session-log.ts`.
- `specs-home-path-builder` (run `db165770`, `blocked`) on a rules-out clause naming `publication-workflow-steps.ts` and `pipeline-chained-workflow-deps.ts`; hand-landed as [#3913](https://github.com/cbrenner04/jarvis/pull/3913) after rewording 3 bullets.

Because `recover` validates one bullet at a time, a tree with N offenders costs N recover round-trips.

## Decisions

- A path inside a rules-out clause (text following `rules out` in the same bullet) is a mention, not an artifact.
- In an acceptance-criteria bullet, a test file path plus the production paths it exercises counts as one artifact (the test).
- Validation reports every offending bullet in the tree in one refusal, not the first only.
- Keep fail-closed for genuine multi-artifact build bullets.

## Acceptance criteria

- [ ] A test proves a Decisions bullet naming one built artifact plus paths inside a rules-out clause passes; it fails against the pre-fix check.
- [ ] A test proves an AC bullet naming a `*.test.ts` path plus the production module(s) it covers passes; it fails against the pre-fix check.
- [ ] A test proves a bullet building two artifacts ("adds `a.ts` and `b.ts`") is still refused.
- [ ] A test proves a tree with several offending bullets is refused once, naming all of them.

## Documentation updates

- `v2/docs/spec-guidance.md` — one-artifact rule: what counts as a mention.
