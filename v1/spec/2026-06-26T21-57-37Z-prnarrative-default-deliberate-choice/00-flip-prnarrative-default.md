# Flip prNarrative default to agent and document the tradeoff

## Problem

`prNarrative` defaults to `template` for both patch and plan
(`DEFAULT_CONFIG` in `v1/src/config.ts`). `template` is deterministic and
cheap but produces low-value PR descriptions; `agent` produces markedly
better descriptions on the same changes (intake #521). Because the default
is the silent path most PRs take, the low-value default under-serves review
on every PR that doesn't opt into `agent`, and the tradeoff is never
surfaced for the operator to weigh.

## Decision

Flip the default to `agent` for both modes; ship the higher-review-value path by default.
- Plausible wrong alternative: keep `template` default. Ruled out: the intake evidence is that `agent` is markedly better and the operator is a single user who can override per-cost-sensitivity; a silent low-value default is worse than a documented-cost good default.
- Override path stays the existing per-mode keys (`modes.patch.prNarrative` / `modes.plan.prNarrative` set to `template`) for deterministic/cheap runs.

Preserve existing `template`-asserting behavior tests by setting `prNarrative: "template"` explicitly in those tests, not by retargeting their assertions to `agent`.
- Plausible wrong alternative: rewrite the run-loop narrative tests to expect agent output. Ruled out: those tests pin template-narrative behavior, which is unchanged — only the default flips; making them explicit keeps their coverage intact.

## Task checklist

- [ ] Change `DEFAULT_CONFIG.modes.patch.prNarrative` and `DEFAULT_CONFIG.modes.plan.prNarrative` to `"agent"` in `v1/src/config.ts`.
- [ ] Update default-config assertions in `v1/test/config.test.ts` and `v1/test/config-command.test.ts` to expect `"agent"`.
- [ ] Pin `prNarrative: "template"` explicitly in `v1/test/run.test.ts` template-narrative tests (the cases noting "With default prNarrative: \"template\"") so they keep testing template behavior.
- [ ] Update `v1/docs/worktrees-and-commits.md` PR narrative section: state `agent` is the default, restate the deterministic-cheap (`template`) vs. contextual/token-heavier (`agent`) tradeoff, and document the override path + cost implication.
- [ ] Update `v2/docs/v1-behaviors.md` to record the new default and the tradeoff.

## Acceptance criteria

- [ ] A freshly bootstrapped config (no operator override) has `modes.patch.prNarrative` and `modes.plan.prNarrative` equal to `agent`.
- [ ] Setting `modes.patch.prNarrative` or `modes.plan.prNarrative` to `template` in config still selects deterministic template narrative for that mode.
- [ ] `v1/test/config.test.ts` and `v1/test/config-command.test.ts` default-config assertions stay green against the new `agent` default.
- [ ] `v1/test/run.test.ts` template-narrative tests stay green (template behavior unchanged; default flip absorbed by explicit per-test `prNarrative: "template"`).
- [ ] `v1/docs/worktrees-and-commits.md` PR narrative section names `agent` as the default and documents the `template`-vs-`agent` tradeoff plus the override path and its cost implication.
- [ ] `v2/docs/v1-behaviors.md` records the `agent` default and the deterministic-cheap vs. agent-contextual tradeoff.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: PR narrative section — new default, tradeoff, override path + cost implication.
- `v2/docs/v1-behaviors.md`: record the chosen default and tradeoff (required: this changes existing v1 default behavior).
