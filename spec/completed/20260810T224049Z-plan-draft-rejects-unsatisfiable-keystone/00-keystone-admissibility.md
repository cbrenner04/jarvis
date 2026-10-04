# Keystone admissibility at plan draft

## Problem

A drafted keystone criterion written as prose ("Keystone checkpoint: inverting the undated-row ordering guard makes the scoped test fail") names no pinning file and no enclosing test title, so `isKeystoneCheckpointBlock` never selects it and `selectKeystoneCheckpointCriteria` never returns it. Today that's not a loud `contract_miss` — the criterion is simply never picked up by keystone verification: it gets ticked and silently never checked, fake evidence rather than a failure. Plan draft currently accepts such a criterion into the drafted tree; only later, if anyone notices the gap, is the cost paid. (This spec does not depend on the implement authoring/linking a keystone directive itself — that path isn't yet observable on `main`.)

## Behavior

Plan-draft normalization refuses a staged tree containing a keystone-marked criterion — one whose block contains `Keystone checkpoint:` outside a backtick span — that is not itself selectable by `selectKeystoneCheckpointCriteria` (canonical suffix `` `pinFile` — `pinTitle`; Keystone checkpoint: `` with a test-file-shaped `pinFile`). The refusal message names the offending subspec file and criterion text. Admissibility is judged from criterion text alone: no on-disk resolution of the named file or test title. A literal `// @mutate` directive does not make an otherwise-non-canonical block admissible — a block with a directive but no canonical suffix is exactly the class this gate excludes, since it's never selected by keystone verification either. Guard (`Mutation checkpoint:`) criteria are out of scope for this gate; they already have a directive-only selection path and unlinked guard criteria already surface as at-risk-hollow-pin advisories.

## Decisions

- The gate runs inside `normalizePlanDraftSpecDir`, before the multi-boundary early return, so it fires on single-boundary drafts too — rules out a separate validator in `v2/src/execution/write.ts`, which would need its own reason plumbing to reach `contract_miss`, and rules out gating only multi-boundary trees.
- Scan scope is `## Acceptance criteria` blocks only (via `acceptanceCriterionBlocks`), one subspec at a time — rules out a whole-file scan, which would refuse this spec's own `## Problem` prose.
- A candidate is a non-`humanOnly` acceptance-criterion block containing `Keystone checkpoint:` outside any backtick run (single- or double-backtick spans both count as "inside") — rules out a bare-substring match, which would refuse the guidance-sanctioned descriptive mention `` `Keystone checkpoint:` ``. Human-only criteria are exempt: they're never selected by keystone verification either, so refusing them gates nothing.
- A candidate is admissible exactly when it's a member of `selectKeystoneCheckpointCriteria(subspecContent)` — the existing selector, called on whole subspec markdown, is the single source of truth for "keystone verification will pick this up"; the gate does not re-implement pin parsing or accept a directive-only alternative path.
- Admissibility never resolves the named file or test title on disk — rules out repeating the #2706 enclosing-test gate, reverted for false-positiving new tests at plan time.
- Checkbox state is ignored (`selectKeystoneCheckpointCriteria`'s default `requireChecked: false`) — drafts author criteria unticked, so a ticked-only gate would never fire at draft.
- A subspec with no `Keystone checkpoint:`-marked criterion at all is unaffected — keystones stay opt-in; this gate only refuses a candidate that names itself as a keystone and fails admissibility.
- v1's `validatePlanDraft` wraps any thrown message it doesn't specifically pattern-match as `plan boundary normalization failed: <message>`; this gate's message is accepted with that generic v1 prefix rather than special-cased, consistent with v1 being maintenance-only.
- Detection lives in `shared/mutation-checkpoint-criteria.ts` next to keystone selection (exported as e.g. `findUnsatisfiableKeystoneCriteria`); `shared/module-boundary-surfaces.ts` only calls it and throws.

## Acceptance criteria

- [x] `shared/module-boundary-surfaces.test.ts` — `a prose-only keystone criterion refuses the staged draft`; a subspec whose only keystone criterion is prose (no canonical suffix, no test-file pin) makes `normalizePlanDraftSpecDir` throw naming the subspec file and criterion text; fails against the pre-fix code, which normalizes the tree silently. `shared/module-boundary-surfaces.test.ts` — `a prose-only keystone criterion refuses the staged draft`; Keystone checkpoint: reverting the gate call in `normalizePlanDraftSpecDir` to a no-op restores baseline admission and turns that test red.
- [x] `shared/module-boundary-surfaces.test.ts` — `the keystone refusal names the offending subspec file and criterion`; `pinFile` — `pinTitle`; Mutation checkpoint: dropping the criterion text or the offending file name from the thrown message must turn that test red.
- [x] `shared/module-boundary-surfaces.test.ts` — `a single-boundary draft with a prose-only keystone still refuses`; a fixture whose acceptance criteria classify to exactly one module boundary (so the multi-boundary early return would otherwise skip the gate) still throws; fails against the pre-fix code.
- [x] `shared/module-boundary-surfaces.test.ts` — `a canonical keystone criterion is admitted`; a criterion carrying the canonical suffix (backticked pinning-test file, em dash, backticked test title, `Keystone checkpoint:`) normalizes without throwing, whether or not it also carries a literal `// @mutate` directive.
- [x] `shared/module-boundary-surfaces.test.ts` — `a double-backticked keystone mention is admitted`; a criterion whose only `Keystone checkpoint:` occurrence is inside a double-backtick code span (the guidance-sanctioned descriptive mention) normalizes without throwing. `pinFile` — `pinTitle`; Mutation checkpoint: treating backtick-wrapped `Keystone checkpoint:` mentions as candidates must turn that test red.
- [x] `shared/module-boundary-surfaces.test.ts` — `a keystone criterion naming a nonexistent pin is admitted`; a canonical-suffix criterion naming a pinning-test file and test title that don't exist on disk normalizes without throwing, proving admissibility reads criterion text only.
- [x] `shared/module-boundary-surfaces.test.ts` — `a human-only keystone-shaped criterion is admitted`; a prose-only `Keystone checkpoint:` criterion marked `(Manual)` normalizes without throwing.
- [x] `shared/module-boundary-surfaces.test.ts` — `a tree with no keystone criteria still normalizes`; a subspec with guard-only or plain acceptance criteria and no `Keystone checkpoint:` mention normalizes without throwing, proving keystones stay opt-in.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan-draft admission refuses a keystone-marked criterion that `selectKeystoneCheckpointCriteria` would never select; keystones stay opt-in.
- `v1/docs/spec-guidance.md` — a keystone criterion must carry the canonical pin suffix (`` `pinFile` — `pinTitle`; Keystone checkpoint: ``); prose-only checkpoints are refused at draft.
- `v2/docs/v1-behaviors.md` — record the changed plan-draft admission behavior, including the `plan boundary normalization failed: <message>` v1 wrapping.
