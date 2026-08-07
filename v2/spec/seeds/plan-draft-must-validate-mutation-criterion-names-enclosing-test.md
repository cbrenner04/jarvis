---
name: plan-draft-must-validate-mutation-criterion-names-enclosing-test
---

# Plan-draft does not enforce that a mutation-checkpoint criterion names its enclosing test, so directives go hollow at implement time

## Problem

`linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text **contains the directive's enclosing `test()`/`it()` title** (`mutation-checkpoint-verifier.ts`). The must-name-enclosing-test rule (`mutation-checkpoint-criterion-must-name-enclosing-test`, #2655) is authoring **guidance** and a plan-review **advisory** pass only — nothing at plan-draft **rejects** a mutation-checkpoint criterion that fails to name a resolvable enclosing test. So a plan lands a criterion like "a `// @mutate` directive inverting the X guard turns that regression RED" (no test title), and at implement time the agent places a correct directive in some test the criterion doesn't name → the directive can't link → **hollow** `contract_miss` — even with a correct implementation and (post-`mutation-checkpoint-pin-resolution`) correct title resolution. Resolution ≠ linking: the pin-resolution fix makes the title *resolvable*; this gap is that the criterion doesn't *contain* it.

## Evidence

- 2026-08-07: `tui-dock-pipeline-steering` subspec 00 hollowed on **two** implement attempts. Its criterion named no test; the agent put the `Object.hasOwn(UNAVAILABLE_COMMANDS, verb)` directive in a `test.each(...)` whose title the criterion didn't contain. Unblocked only by hand-rewriting the criterion to be prescriptive (exact plain-`test` title `still-unavailable verbs classify as recognized_unavailable` + exact directive, #2697), after which the re-run linked and completed.
- The `mutation-checkpoint-pin-resolution` spec (#2696) explicitly **deferred** this to "first consumer" — pipeline-steering was that consumer.

## Decisions

- Plan-draft (and/or the plan debate review as a hard, not advisory, gate) MUST reject a subspec whose ticked/authored `Mutation checkpoint:` (or directive-shaped `@mutate`) criterion does not name an enclosing `test()`/`it()` title that resolves in the referenced pinning file — rules out landing a criterion that will hollow at implement time regardless of a correct implementation. Advisory hollow-pin (#2660) and criterion-naming guidance (#2655) already exist but do not block.
- The check names the offending criterion and the missing/unresolvable test title — rules out a generic "hollow risk" warning the author can ignore.
- Scope: plan-draft/plan-review seam only (not the implement-time verifier, which already reports hollow correctly). Out of scope: multiline-title resolution and extension tolerance (shipped in `mutation-checkpoint-pin-resolution`).

## Acceptance criteria

- [ ] A plan draft/review over a spec whose `Mutation checkpoint:` criterion names no enclosing test (or names one absent from the pinning file) is rejected/flagged-as-blocking, naming the criterion and the unresolvable title; a regression fails against the current advisory-only behavior.
- [ ] A plan whose mutation-checkpoint criteria all name resolvable enclosing tests passes with no finding.
- [ ] Mutation checkpoint: a `// @mutate` directive (inside the named pinning test) disabling the criterion-names-test check turns the regression RED.
- [ ] `bun run typecheck` and the touched surface's test script pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — the criterion MUST name its enclosing test (now enforced at plan-draft, not just guidance).
- `v2/docs/operator-runbook.md` § Gate trust — plan-draft rejects a mutation-checkpoint criterion that names no resolvable enclosing test; the implement-time hollow is thereby caught at plan time.
