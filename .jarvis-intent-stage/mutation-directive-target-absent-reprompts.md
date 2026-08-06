---
name: mutation-directive-target-absent-reprompts
---

# A `target_absent` mutation-checkpoint directive reprompts instead of hard-blocking implement completion

The fix touches one module-boundary surface (execution loop), so splitting does not apply.

Plan-authored `@mutate` directives often quote call syntax the implementer later writes with different
arity, renamed locals, or multiple call sites. `verifyMutationCheckpoints` correctly reports
`target_absent`/`target_ambiguous`, but `spec.criteria-ticked` settles `contract_miss` /
`resumable: false` even though production behavior is done and the pin is one directive edit from
correct. Observed on all three `implement-completion-honesty` subspecs (2026-08-05).

## Decisions

- When `spec.criteria-ticked` fails **only** because a selected criterion's linked directive is
  `target_absent` or `target_ambiguous` — not hollow, not missing-directive, not
  `unresolved_pinning_test`, not a real red scoped suite — the write loop reprompts with the named
  `pinningFile:line`, raw directive, and reason so the agent retargets the quoted original to a
  unique landed anchor, within the existing iteration budget — rules out settling
  `blocked`/`resumable: false` on a one-line pin-text mismatch the agent can self-heal.
- Hollow, missing-directive, `unresolved_pinning_test`, and red-suite failures still settle
  `contract_miss` with harness `## Blocker` append — rules out reprompting every unparseable
  checkpoint.
- Budget exhaustion with the directive still unparseable settles terminal `contract_miss` /
  `resumable: false` — rules out unbounded repair.
- Reprompt payload carries `pinningFile:line`, raw directive, and `target_absent`/`ambiguous`
  reason verbatim — rules out a generic contract-miss message the agent cannot act on.
- Plan authoring: prefer a unique stable anchor (definition line, unique enclosing statement) over a
  bare call expression whose argument names/arity may change or which recurs at multiple sites —
  rules out runtime-only fix that leaves plans authoring fragile pins.
- Out of scope: changing the `@mutate` single-line replacement format or the strict linker.

## Acceptance criteria

- [ ] A write-loop regression drives a ticked mutation-checkpoint criterion whose pinning-file
      directive is `target_absent` against the landed source, and asserts the loop **reprompts**
      (records the directive + `target_absent` reason and re-enters the agent) instead of settling
      `blocked`/`resumable: false`; a run that exhausts the reprompt budget still blocks. Fails
      against the current hard-block boundary.
- [ ] The reprompt payload names the offending `pinningFile:line`, the raw directive, and the
      `target_absent`/`ambiguous` reason verbatim; a test pins the payload text.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — prefer a unique/stable anchor for
      the directive's quoted original; a bare call expression with implementer-chosen argument names
      or multiple call sites risks `target_absent`/ambiguous.
- [ ] Mutation checkpoint: a `// @mutate` directive inverting the "unparseable-only → reprompt"
      predicate (so it falls through to hard block) turns its pinning test RED; author it single-line
      naming the enclosing test verbatim.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `spec.criteria-ticked` reprompts on `target_absent`/`ambiguous`
  linked directives within the iteration budget; budget exhaustion still settles `contract_miss`.
- `v2/docs/operator-runbook.md` § Gate trust — reprompt replaces the operator hand-fix workaround
  for plan-authored pin-text mismatch; delete the 2026-08-05 bullet when this ships.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — stable-anchor guidance above.
- `v2/docs/v1-behaviors.md` — record the reprompt boundary for unparseable-only mutation directives.

## Prerequisites

- `verifyMutationCheckpoints` reports `unparseable` entries with `target_absent`/`target_ambiguous`
  reasons and `pinningFile:line` coordinates.
- The write-loop `spec.criteria-ticked` boundary settles `contract_miss` / `resumable: false` on
  unparseable checkpoints in opened pinning files.
- The write loop has a bounded iteration budget consumed by ordinary step iterations.
