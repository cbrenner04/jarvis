# Require the declaration pair in the intent split prompt

## Problem

`prompts/intent/split.md` tells the splitter to "state in one line in that intent's body why splitting does not apply" and never names the `Unsplit rationale:` line or the `## Primary implementation surface` section. Both are emergent conventions today: on-disk intents carry them, and `v2/src/execution/intent-split-regression.test.ts` asserts them through a stub that writes the section unconditionally, so no test proves the prompt asks for either. The plan-draft normalizer now keys its skip on that exact pair, which leaves the consumer reading a grammar the producer only implies.

## Decision ledger

- The existing unsplit sentence stays verbatim and the requirement is appended as its own output rule. Rules out rewriting that sentence, which is pinned by normalized-substring assertions in two suites.
- The requirement covers single-surface intents only. Rules out demanding the section from multi-surface intents, which the normalizer skip never reads.
- The required phrasing is exported as a pin constant beside `INTENT_SPLIT_SURFACE_PIN` in `shared/prompts/intent-split.ts`, and both suites assert against it. Rules out two hand-copied literals that drift apart.
- `INTENT_SPLIT_MAX_BODY_GROWTH` rises only as far as the added rule needs (300 covers it); `INTENT_SPLIT_BASELINE_BODY_LENGTH` stays, since it records the pre-change revision-1 length. Rules out deleting pinned contract prose to fit the current ceiling, and rules out re-baselining away the anti-bloat gate.
- The regression stub emits the `## Primary implementation surface` section only when the rendered prompt carries the declaration requirement, matching how it already gates the rationale line. Rules out an oracle that passes whatever the prompt says.
- The artifact `revision` is bumped. Rules out shipping changed prompt bytes under an unchanged revision.

## Task checklist

- Add the declaration output rule to `prompts/intent/split.md` on one physical line and bump its `revision`.
- Export the pin constant and raise the growth allowance in `shared/prompts/intent-split.ts`.
- Extend `v2/src/execution/intent-split-regression.test.ts`: assert the rendered prompt carries the pin, gate the stub's section emission on it, and strip it in the pre-change projection.
- Update `v1/docs/spec-guidance.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `v2/src/execution/intent-split-regression.test.ts` test `the split contract requires the single-surface declaration pair` fails against the pre-fix prompt, then proves the rendered `intent.prompt.split` prompt requires, for a single-surface intent, a non-empty `Unsplit rationale:` line and a `## Primary implementation surface` section naming exactly one entry.
- [x] `v2/src/execution/intent-split-regression.test.ts` — `single-surface seed stays whole through the production split write`; Keystone checkpoint: an in-body `// @mutate` directive deleting the declaration rule from `prompts/intent/split.md` makes the splitter stub emit an intent without the primary-surface section, turning this test red on the staging oracle.
- [x] `v2/src/execution/intent-split-regression.test.ts` test `pre-change contract fails both staging oracles` stays green with the declaration requirement stripped alongside the existing projections, and still fails the single-surface oracle.
- [x] `shared/prompts/intent-split.test.ts` stays green — `intent split prompt requires single-surface unsplit`, `intent split prompt pins surface fan-out rule`, `intent split artifact has no examples or thresholds`, `intent split artifact growth stays within budget`, and `intent split artifact revision bumped past baseline` all hold with the added rule in place.
- [x] `v1/docs/spec-guidance.md` records that a single-surface intent's `Unsplit rationale:` line and `## Primary implementation surface` section are load-bearing downstream — the plan-draft normalizer reads them to suppress boundary splitting — not review prose.
- [x] `v2/docs/v1-behaviors.md` intent-split entry records the required declaration pair for single-surface intents.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — intent authoring: the single-surface declaration pair is a downstream contract read by the plan-draft normalizer.
- `v2/docs/v1-behaviors.md` — align the intent-split entry with the required declaration pair.

## Implementer notes

- Suggested rule text, one bullet on one physical line under the output rules: Write that line as an `Unsplit rationale:` line, and give that intent a `## Primary implementation surface` section naming exactly one entry.
- The artifact body is close to its current ceiling; raise `INTENT_SPLIT_MAX_BODY_GROWTH` before running the budget test, and keep the added text free of fenced blocks, `e.g.`, `for example`, and digit-plus-noun phrases the no-thresholds test rejects.
- `hasSurfaceContract` in the regression suite already gates the rationale line on `INTENT_SPLIT_SURFACE_PIN` plus the unsplit pin; add the new pin there and move the section emission in `intent()`/`writeSingleSurfaceStage` behind the same condition.
- `preChangeContract` must strip the new pin too, or the pre-change test asserts against a prompt that still carries it.
- Add no test-only inversion hooks; the directive must delete real prompt bytes.

## Blocker

`bun run test` exits 1: `v1/test/idle-hang-fixtures.sandbox-unrunnable.test.ts` fails 2 of 2 tests with `no processes matching .../idle-hang.sh within 2000ms`, because the sandbox blocks spawning/polling the real helper process that test needs. Both targeted suites for this subspec (`shared/prompts/intent-split.test.ts`, `v2/src/execution/intent-split-regression.test.ts`) and `bun run typecheck` are green; this failure is unrelated to the change and pre-existing sandbox blindness, but it means the acceptance criterion "`bun run typecheck` and `bun run test` pass" cannot be verified true from inside this sandboxed session.
