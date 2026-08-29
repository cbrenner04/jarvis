---
name: retire-mutation-checkpoint-dsl
---

# Retire the mutation-checkpoint DSL; diff-derived verification is the sole mutation gate

## Problem

Mutation enforcement runs as two layers. The diff-derived verifier (ready finalization, `diff-derived-mutation-verifier.ts`) derives candidates from the run's production diff, applies each, and requires a scoped-suite red — mechanical, format-free, and the layer that catches real test gaps. On top of it, `prompts/plan/draft.md` mandates a guard-inversion AC on every code-touching subspec (#1948), and spec-guidance grew a formal authoring language to make those ACs verifiable: canonical `` `pinFile` — `pinTitle`; Mutation checkpoint: `` suffixes, `// @mutate` directives, keystone variants, verified at implement completion by the checkpoint verifier with three reprompt prompts and durable reprompt/resume machinery. Plan agents author that DSL at a point where it cannot be validated — the named test does not exist yet (#2706 reverted for exactly this) — so format drift surfaces as `contract_miss` at implement completion and hand-demotion at salvage. Cost to date: ~30 of 566 completed spec trees and ~248 of 3,463 commits fix the DSL machinery itself; hollow/split keystone pins still recur (2026-08-28 session report), and the operator hand-embeds enclosing-test titles at plan merge.

## Decisions

- The guard-inversion AC mandate is removed from `prompts/plan/draft.md`; the named-failing-test rule (a test that fails pre-fix and passes post-change) stays. Rules out plans authoring checkpoint-format ACs at all.
- Spec-guidance drops the `Mutation checkpoint:` / `Keystone checkpoint:` authoring contract (canonical suffix, `@mutate` directive format, placement rules); plan-review's at-risk hollow-pin injection and plan-draft's keystone-shape rejections retire with it. Rules out the recurring hollow/split-pin `contract_miss` class and the plan-merge hand-fixing.
- Diff-derived mutation verification and the `write.mutation-repair` loop remain the sole mutation gate, unchanged. Rules out losing the enforcement that has caught real gaps.
- Keystones retire with the DSL; the shipped-no-op case stays covered by runtime smoke verification. No operator-authored keystone escape hatch survives.
- The implement-time checkpoint machinery — `mutation-checkpoint-verifier.ts`, the `write.mutation-directive-reprompt` / `write.keystone-directive-reprompt` / `write.guard-checkpoint-reprompt` prompts, reprompt-context persistence and paused-resume replay, and their TUI/doc surfaces — is deleted. Sequencing: prompt/guidance retirement lands first (independently valuable; the verifier only fires on checkpoint-shaped criteria, so it goes dormant as soon as plans stop emitting the format); deletion follows once in-flight spec trees authored under the mandate drain. Rules out carrying a dormant complexity magnet.
- No new DSL-hardening work is accepted in the interim; seeds touching this machinery must delete surface, not extend it.

## Acceptance criteria

- [ ] Plan-draft prompt and rendered snapshots carry no guard-inversion mandate, and drafted ACs for a code-touching intent contain no `Mutation checkpoint:` / `Keystone checkpoint:` / `@mutate` shapes, pinned by the plan-draft prompt tests.
- [ ] Implement completion no longer selects, verifies, or reprompts on checkpoint-shaped criteria; the three reprompt prompt IDs and the checkpoint verifier are gone, pinned by write-loop tests.
- [ ] Diff-derived mutation verification and mutation-repair behavior are unchanged, pinned by their existing tests staying green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — remove the mutation/keystone checkpoint authoring sections; keep the named-failing-test guidance.
- `v2/docs/write-behavior.md`, `v2/docs/prompts.md`, `v2/docs/test-writing.md` — remove checkpoint-verifier, reprompt, and pin-classifier contracts; diff-derived verification sections stay.
- `v2/docs/v1-behaviors.md` — record the retired guard-inversion mandate.
- `v1/docs/operator-runbook.md` — note the retirement and the no-new-DSL-hardening rule.
