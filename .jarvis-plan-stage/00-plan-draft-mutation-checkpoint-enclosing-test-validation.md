# Plan-draft enclosing-test validation

## Problem

`linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's enclosing `test()`/`it()` title (`criterionText.includes(directive.pinTitle)`, case-sensitive, no all-directives-in-file fallback). Authoring guidance (#2655) and plan-review advisory hollow-pin (#2660) do not block plan-draft, so criteria omitting the pin title land and go hollow at implement time even when the directive and pinning resolution are correct.

## Decisions

- Plan-draft MUST hard-reject staged subspecs whose non-human-only `Mutation checkpoint:`, `Keystone checkpoint:`, or directive-shaped `@mutate` criterion does not name an enclosing `test()`/`it()` title resolvable in the referenced pinning file — rules out advisory-only hollow-pin (#2660) or implement-time-only detection.
- Rejection names the offending criterion and the missing or unresolvable test title — rules out a generic hollow-risk warning the author can ignore.
- Validation runs in v2 `validatePlanDraft` / `composePlanDraftArtifactCheck` on the staged spec tree after `normalizePlanDraftSpecDir` succeeds — rules out plan-review-only hard enforcement; plan debate hollow-pin stays advisory.
- `validatePlanDraft` and `composePlanDraftArtifactCheck` take `worktreeRoot` alongside `specDir`; `executePlanDraftWrite` passes its in-scope `worktreePath` — rules out pinning checks against spec-dir alone or a caller-side parallel validator.
- Scan `## Acceptance criteria` mutation-checkpoint-shaped and keystone-checkpoint-shaped criteria in staged `NN-*.md` subspecs via `shared/mutation-checkpoint-criteria.ts` selectors (checked and unchecked; skip human-only); exclude `index.md` and `intent.md` — rules out index routing noise.
- Enclosing-test check aligns with implement-time linking: when pinning-file resolution succeeds to an on-disk file, criterion block text must `includes` at least one pin title that exists in that file (case-sensitive) — rules out the weaker backtick/quote heuristic alone (#2660) and deferring to implement for titles absent from a resolved pinning file (#2697 scope is existing titles omitted from criterion text, not greenfield test authoring).
- Pinning-file resolution reuses verifier pin-path rules (`pinningTestReferenceFromCriterion`, path-qualified vs basename, extension tolerance from `mutation-checkpoint-pin-resolution`) — rules out divergent plan-draft vs implement resolution.
- Pinning-file resolution failure (unresolved reference, ambiguous basename, missing file) skips the plan-draft enclosing-test check for that criterion — rules out plan-draft duplicating implement-time pinning refusal or blocking specs whose pinning files do not exist yet.
- Rejection propagates through existing plan-draft `contract_miss` plumbing: `failedContractId` stays `"artifact.exists"`; `failureReason` carries the enclosing-test diagnostic — rules out a new contract id or implement-time-only messaging.
- Implement-time verifier and hollow messaging unchanged — rules out re-tuning `contract_miss` at implement in this slice.
- v1 `validateDraftOutput` out of scope — rules out v1 parity here (cf. unsatisfiable-AC v2 deferral).
- Out of scope: multiline-title resolution and extension-tolerance algorithm changes (shipped #2696).

## Tasks

- Extend `validatePlanDraft` and `composePlanDraftArtifactCheck` in `v2/src/execution/write.ts` to accept `worktreeRoot`; wire `executePlanDraftWrite` to pass `worktreePath`.
- After successful `normalizePlanDraftSpecDir`, walk staged `NN-*.md` subspecs and run enclosing-test validation on mutation-checkpoint-shaped and keystone-checkpoint-shaped criteria using shared selectors.
- Reuse or export verifier pinning resolution and add pin-title extraction from resolved pinning files (all resolvable `test()`/`it()` titles in file, including multiline `test.each` continuation titles per shipped verifier behavior).
- Add `write.test.ts` regressions for omission rejection, well-formed pass, missing pinning-file skip, and guard inversion on the enclosing-test check.
- Update operator and authoring docs per Documentation updates.

## Acceptance criteria

- [ ] `write.test.ts` drives plan-draft `contract_miss` with agent output under `expectedArtifactPath` on a staged subspec whose mutation-checkpoint or keystone criterion names the pinning file and directive but omits any enclosing `test()` title present in that file (or names only a title absent from the resolved on-disk pinning file); asserts `failedContractId` is `"artifact.exists"` and `failureReason` names the criterion and the missing or unresolvable title; fails against advisory-only plan-review hollow-pin behavior (pre-fix code).
- [ ] `write.test.ts` drives plan-draft completion when staged mutation-checkpoint criteria each name a resolvable enclosing test title in their resolved pinning files; asserts no enclosing-test `contract_miss`; fails against the pre-fix code.
- [ ] `write.test.ts` drives plan-draft completion when a staged mutation-checkpoint criterion references a pinning file missing on disk; asserts enclosing-test validation produces no finding; fails if plan-draft hard-rejects unresolved pinning.
- [ ] Mutation checkpoint: in `write.test.ts`, the test titled `plan-draft contract_miss when mutation-checkpoint criterion omits enclosing test title` carries a `// @mutate` directive inside that test body inverting the plan-draft enclosing-test validation guard; the mutation turns that test RED. (Criterion names the enclosing `test()` title verbatim.)
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria states enclosing-test names are enforced at plan-draft, not guidance-only.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents plan-draft rejection when a mutation-checkpoint or keystone criterion names no resolvable enclosing test in a resolved pinning file.
- [ ] `v2/docs/v1-behaviors.md` records plan-draft hard rejection of mutation-checkpoint / keystone criteria missing a resolvable enclosing pin title.
- [ ] `v2/docs/write-behavior.md` § Draft output shape contract documents enclosing-test `contract_miss` / `failureReason` propagation alongside existing normalizer rejection diagnostics.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — criterion MUST name its enclosing test (enforced at plan-draft, not guidance-only).
- `v2/docs/operator-runbook.md` § Gate trust — plan-draft rejects a mutation-checkpoint or keystone criterion that names no resolvable enclosing test in a resolved pinning file; implement-time hollow is caught at plan time.
- `v2/docs/v1-behaviors.md` — plan-draft hard-rejects mutation-checkpoint / keystone criteria missing a resolvable enclosing pin title.
- `v2/docs/write-behavior.md` § Draft output shape contract — enclosing-test rejection `contract_miss` / `failureReason` propagation.
