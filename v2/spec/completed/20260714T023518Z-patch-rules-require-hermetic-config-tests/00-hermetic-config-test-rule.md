# 00 - Hermetic-config test rule in patch rules

## Problem

Patch agents author tests that hit machine-config resolution (`resolveMachineProfile`, or
`loadWorkflowSteps` with no injected profile) without a fixture, because no rule forbids it.
Such tests read the operator's ambient `~/.jarvis` config: green locally, red in CI. Observed
2026-07-11 on `workflow-loader-review-debate-steps`; the sibling `review-steps` spec's
equivalent test injected a profile and passed.

## Decisions

- Rule lives in `prompts/patch/rules.md` (`patch.rules`), phrased target-repo-agnostic ("machine/user config") rather than naming v2 symbols — the fragment ships to every target repo, not just jarvis.
- Bump `patch.rules` revision and `patch.prompt.body` revision, adding `patch.prompt.body@r<n>` shared + codex-wrapper fixtures; rules text is inlined into the rendered body, so leaving the body revision fixed would force an edit of an already-shipped snapshot fixture instead of recording a new one.
- Governance coverage is an assertion in `v1/test/prompt.test.ts` that the rendered patch prompt contains the rule sentence — snapshot fixtures alone would let the rule be deleted with a fixture regen.
- No runtime or test-harness change; no new lint/guard on test files.

## Task checklist

- [ ] Add the one-line rule to `prompts/patch/rules.md`; bump its `revision`.
- [ ] Bump `patch.prompt.body` revision in `prompts/patch/instructions.md`; add the new rendered fixtures under `v1/test/fixtures/prompts/rendered/`.
- [ ] Update the revision assertions in `v1/test/prompts/rendered-snapshots.test.ts`.
- [ ] Add the rule-presence assertion to `v1/test/prompt.test.ts`.
- [ ] Update `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `prompts/patch/rules.md` carries one terse rule requiring that a test reaching machine/user-config resolution inject an explicit profile and config path/fixture, never reading the ambient machine config.
- [x] The rendered patch-mode prompt an agent receives contains that rule sentence, asserted in `v1/test/prompt.test.ts` (deleting the rule from `rules.md` fails the suite).
- [x] `v1/test/prompts/rendered-snapshots.test.ts` passes against fixtures keyed at the bumped `patch.prompt.body` revision.
- [x] `bun run typecheck` and `bun run test:v1` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record the new patch-rules guidance (hermetic machine-config tests) with the bumped `prompts/patch/rules.md` revision, alongside the existing patch-rules entries.
