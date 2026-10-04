# Pin-title authoring guidance and operator runbook

## Problem

`linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's enclosing `test()` title (pin title / `directive.pinTitle`) via case-sensitive `includes(pinTitle)`. Since `mutation-checkpoint-verifier-trust` dropped the all-directives-in-file fallback, loose references ("on the pinned-argv test", "its regression") link nothing and the checkpoint goes `hollow`, blocking completion even when the directive is present and correct. Plans and authoring guidance do not yet require the enclosing `test()` title, so implement runs block on hollow checkpoints for a purely referential reason.

## Decision ledger

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria MUST require the enclosing `test()` title (pin title / `directive.pinTitle`) verbatim or as a linker-matching substring in every mutation-checkpoint criterion — rules out loose references that go hollow under the no-fallback linker.
- `v2/docs/operator-runbook.md` § Gate trust documents the first-hollow linker-miss failure mode (blocker `no @mutate directive linked to this criterion; add // @mutate … on the named pin` even when a directive exists but the criterion omits the enclosing `test()` title) and its fix (edit the criterion — not add/repair the directive, not proof-form or directive-syntax) — placed before the premise-smell hollow bullet so operators do not follow the opposite fix.
- Gate-visible doc assertion in `test/spec-guidance-doc-assertions.test.ts` encodes the spec-guidance rule (enclosing `test()` title required; case-sensitive `includes(pinTitle)`; substring sufficient; loose references go hollow) — rules out guidance that drifts out of the durable doc without CI signal.
- Close `v2/spec/implement-queue.md` row #2 (`seeds/mutation-checkpoint-criterion-must-name-enclosing-test`) when the guidance ships — rules out a stale queue item for consumed work.
- Out of scope: reintroducing the all-directives-in-file fallback; plan-review hollow-pin flagging (`v2/spec/ready-intents/plan-review-hollow-pin-criterion.md`).

## Prerequisites

- `linkDirectivesToCriterion` in `v2/src/execution/mutation-checkpoint-verifier.ts` filters directives with `criterionText.includes(directive.pinTitle)` and has no all-directives-in-file fallback (`mutation-checkpoint-verifier.test.ts` — `no pin match inherits no directives`).

## Tasks

- Add a bullet to `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria: every mutation-checkpoint criterion must include the enclosing `test()` title (pin title / `directive.pinTitle`); linker matching is case-sensitive `criterionText.includes(directive.pinTitle)` with no fallback — a substring of the full title suffices, different casing does not; loose references that name only the pinning file or paraphrase the test do not link and go `hollow`. Include at least one good/bad criterion example (e.g. bad: "on the pinned-argv test in `write.test.ts`"; good: embeds the exact `test("pinned argv passes through unchanged", …)` title).
- Add `test/spec-guidance-doc-assertions.test.ts` asserting § Mutation-checkpoint criteria documents: every criterion must include the enclosing `test()` title; matching is case-sensitive `includes(pinTitle)` with a substring sufficient; loose references go `hollow` under the no-fallback linker — not a bare token-presence guard.
- Add a Gate trust bullet to `v2/docs/operator-runbook.md` **before** the premise-smell hollow bullet: first hollow from linker miss — blocker `no @mutate directive linked to this criterion; add // @mutate … on the named pin` even when a `// @mutate` directive exists but the criterion names the pinning file without the enclosing `test()` title; fix by editing the criterion to include that title (verbatim or linker-matching substring) — not by adding/repairing the directive, and not a proof-form or directive-syntax problem; cross-reference the premise-smell bullet below for the opposite case (second hollow on a different guard → do **not** amend the criterion).
- Remove or close `v2/spec/implement-queue.md` row #2 (`seeds/mutation-checkpoint-criterion-must-name-enclosing-test`).
- Run `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared`.

## Acceptance criteria

- [x] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria instructs authors to include the enclosing `test()` title (pin title / `directive.pinTitle`) in every mutation-checkpoint criterion; defines linker matching as case-sensitive `criterionText.includes(directive.pinTitle)` with no fallback (substring of the full title suffices, different casing does not); states that loose references go `hollow` under the no-fallback linker; includes at least one good/bad criterion example.
- [x] `test/spec-guidance-doc-assertions.test.ts` asserts § Mutation-checkpoint criteria documents the enclosing-`test()`-title requirement, case-sensitive `includes(pinTitle)` matching with substring sufficiency, and hollow-on-loose-reference behavior; fails when that guidance is removed or reduced to token presence only.
- [x] `v2/docs/operator-runbook.md` § Gate trust documents first-hollow linker-miss (blocker `no @mutate directive linked to this criterion; add // @mutate … on the named pin` when a directive exists but the criterion omits the enclosing `test()` title) and the fix (edit the criterion to include the title — not add/repair the directive, not proof-form or directive-syntax); the bullet is placed before the premise-smell hollow bullet and cross-references it for the opposite fix on second hollow.
- [x] `v2/spec/implement-queue.md` no longer lists row #2 (`seeds/mutation-checkpoint-criterion-must-name-enclosing-test`).
- [x] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — enclosing-`test()`-title requirement, linker-matching definition, good/bad examples, hollow-on-loose-reference behavior.
- `v2/docs/operator-runbook.md` § Gate trust — first-hollow linker-miss failure mode, real blocker text, fix vs premise-smell hollow.
- `v2/spec/implement-queue.md` — close row #2 (`seeds/mutation-checkpoint-criterion-must-name-enclosing-test`).
