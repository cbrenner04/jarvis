---
name: mutation-checkpoint-criterion-must-name-enclosing-test
---

# Mutation-checkpoint criteria that don't name their enclosing test go hollow

Since `mutation-checkpoint-verifier-trust` dropped the all-directives-in-file fallback, `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's enclosing test name (its pin title). A criterion that references the pin loosely — "on the pinned-argv test", "its regression" — links to **no** directive and the checkpoint is reported `hollow`, blocking completion, even though the directive is present and correct in the pinning file.

This is the stricter linker working as designed, but plans/authoring do not yet know to name the enclosing test verbatim, so implement runs block on hollow checkpoints for a purely referential reason.

## Evidence

- 2026-08-05, `claude-include-partial-messages` implement (run 62c3cddf): the directive
  `// @mutate shared/invocation/agents.ts "--include-partial-messages" -> ""` was present
  at `agents.test.ts:237` inside `test("claude binding invokes the CLI shape with cwd and
  stdin prompt", …)`, but the criterion said "on the pinned-argv test" — no pin-title
  match → `Hollow mutation checkpoints: no @mutate directive linked to this criterion` →
  blocked. Fixed by editing the criterion to name the enclosing test verbatim; the
  directive then linked and reddened the test.

## Decisions

- Update authoring guidance (`v1/docs/spec-guidance.md` § Mutation-checkpoint criteria):
  a mutation-checkpoint criterion MUST contain the enclosing test's name verbatim (or a
  substring the linker matches), because the fallback is gone; a loose reference is a
  hollow pin.
- Plan review should flag a mutation-checkpoint criterion whose text does not name a
  plausible test title (heuristic: no backticked/quoted test-name-like token beyond the
  pinning file and directive) — surfacing the hollow risk at plan time, not implement
  time. Extends `plan-review-must-falsify-guard-premises`.
- Out of scope: reintroducing the all-directives fallback (deliberately removed).

## Acceptance criteria

- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria instructs authors to name
      the enclosing test verbatim in the criterion; a doc assertion or lint covers the
      guidance presence.
- [ ] Plan review reports a mutation-checkpoint criterion that names no enclosing test
      (only the pinning file + directive) as an at-risk hollow pin; a regression feeds
      such a criterion and asserts the plan-review flag fires, and a well-formed criterion
      does not trip it.
- [ ] Mutation checkpoint: a `// @mutate` directive disabling the plan-review hollow-pin
      heuristic turns the regression RED; pin via a unique-basename test, naming the
      enclosing test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — name the enclosing test
  verbatim; loose references go hollow under the no-fallback linker.
- `v2/docs/operator-runbook.md` § Gate trust — note the hollow-on-unnamed-test failure
  mode and its fix.

## Prerequisites

- `linkDirectivesToCriterion` (`v2/src/execution/mutation-checkpoint-verifier.ts`) — the
  no-fallback pin-title matching
- The plan-review step (`review-plan` prompt/roles) for the authoring-time flag
- `v1/docs/spec-guidance.md` mutation-checkpoint authoring section
