# Pin-title authoring guidance and operator runbook

## Problem

`linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's pin title (`includes(pinTitle)`). Since `mutation-checkpoint-verifier-trust` dropped the all-directives-in-file fallback, loose references ("on the pinned-argv test", "its regression") link nothing and the checkpoint goes `hollow`, blocking completion even when the directive is present and correct. Plans and authoring guidance do not yet require the pin title, so implement runs block on hollow checkpoints for a purely referential reason.

## Decision ledger

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria MUST require the enclosing `test()` title (the directive's pin title) verbatim or as a linker-matching substring in every mutation-checkpoint criterion — rules out loose references that go hollow under the no-fallback linker.
- `v2/docs/operator-runbook.md` § Gate trust documents the hollow-on-unnamed-test failure mode and fix (edit the criterion to include the pin title) — rules out operators treating it as a proof-form or directive-syntax problem.
- Gate-visible doc assertion in `test/spec-guidance-doc-assertions.test.ts` covers the spec-guidance rule — rules out guidance that drifts out of the durable doc without CI signal.
- Out of scope: reintroducing the all-directives-in-file fallback; plan-review hollow-pin flagging (`v2/spec/ready-intents/plan-review-hollow-pin-criterion.md`).

## Prerequisites

- `linkDirectivesToCriterion` in `v2/src/execution/mutation-checkpoint-verifier.ts` filters directives with `criterionText.includes(directive.pinTitle)` and has no all-directives-in-file fallback (`mutation-checkpoint-verifier.test.ts` — `no pin match inherits no directives`).

## Tasks

- Add a bullet to `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria: every mutation-checkpoint criterion must include the directive's pin title (the enclosing `test()` title) verbatim or as a linker-matching substring; loose references that name only the pinning file or paraphrase the test do not link and go `hollow`.
- Add `test/spec-guidance-doc-assertions.test.ts` asserting that § Mutation-checkpoint criteria contains the pin-title requirement; fails when the guidance is absent.
- Add a Gate trust bullet to `v2/docs/operator-runbook.md`: hollow checkpoints from criteria that omit the enclosing `test()` title (loose references link no directive under the no-fallback linker); fix by editing the criterion to include the pin title verbatim or as a linker-matching substring — not a proof-form or directive-syntax problem.
- Run `bun run typecheck` and `bun run test` (root `test/` scope for the new assertion file).

## Acceptance criteria

- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria instructs authors to include the directive's pin title (the enclosing `test()` title) in every mutation-checkpoint criterion, verbatim or as a linker-matching substring, and states that loose references go `hollow` under the no-fallback linker.
- [ ] `test/spec-guidance-doc-assertions.test.ts` asserts the pin-title requirement is present in `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria; fails when that guidance is removed.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents the hollow-on-unnamed-test failure mode (criterion names the pinning file but omits the enclosing `test()` title, so `linkDirectivesToCriterion` links no directive) and the fix (edit the criterion to include the pin title verbatim or as a linker-matching substring).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — pin-title requirement and hollow-on-loose-reference behavior.
- `v2/docs/operator-runbook.md` § Gate trust — hollow-on-unnamed-test failure mode and fix.
