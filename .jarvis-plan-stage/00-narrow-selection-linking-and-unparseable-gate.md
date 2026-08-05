# Narrow selection, linking, and unparseable gate

## Problem

- Bare `@mutate` substring selection treats prose mentions as checkpoint claims.
- `linkDirectivesToCriterion` inherits every file directive when no pin title matches.
- `parseMutateDirectives` reports unparseable entries from string literals.
- `unparseable` entries log to stderr and do not block completion.

## Decisions

- Select on `Mutation checkpoint:` or a `DIRECTIVE_PATTERN` match, not bare `@mutate` prose — rules out prose-only selection while keeping directive-shaped criterion text.
- Drop the all-directives-in-file fallback in `linkDirectivesToCriterion` — rules out inherited claims when the named pin has no directive.
- Restrict unparseable collection to comment-leading `@mutate` lines — rules out string-literal false positives.
- Treat criterion-scoped `unparseable` entries like `hollow` at the `spec.criteria-ticked` boundary, naming criterion text, raw reference, and reason — rules out stderr-only visibility for ticked checkpoints.
- Keep directive syntax, phrase-only selection, and scoped-run lifecycle unchanged in this subspec — rules out bundling resolution or abort wiring here.

## Tasks

- Narrow criterion selection in `mutation-checkpoint-verifier.ts` to `CRITERION_MARKER` or `DIRECTIVE_PATTERN`.
- Remove the all-directives fallback; unresolved pin linkage yields no inherited directives.
- Gate `parseMutateDirectives` unparseable reporting on comment-leading lines.
- Extend the implement `spec.criteria-ticked` contract in `write.ts` to refuse on non-empty `report.unparseable` for selected criteria.
- Add regressions in `mutation-checkpoint-verifier.test.ts` and `write.test.ts`.
- Run a fixture pass over `v2/spec/completed/20260802T045701Z-verify-directive-only-mutation-criteria/00-verify-directive-only-mutation-criteria.md`.
- Update operator gate-trust and authoring guidance for narrowed selection and blocking unparseable.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `prose @mutate without a directive-shaped occurrence is not selected` proves a ticked criterion naming `@mutate` in prose produces no `hollow` entry; it fails against the bare-substring selector.
- [ ] `mutation-checkpoint-verifier.test.ts` — `a ticked criterion quoting a directive-shaped @mutate occurrence is still verified` proves a criterion embedding a full `// @mutate <path> "<old>" -> "<new>"` shape is selected and reaches `caught` when the mutation turns the scoped suite red.
- [ ] `mutation-checkpoint-verifier.test.ts` — `no pin match inherits no directives` proves a criterion whose pin title matches no enclosing test reports `unresolved_pinning_test` (or equivalent linkage failure) and does not inherit other pins' directives; it fails against the all-directives fallback.
- [ ] `mutation-checkpoint-verifier.test.ts` — `fixture subspec discussing @mutate in prose reports zero hollow entries` runs verification over `v2/spec/completed/20260802T045701Z-verify-directive-only-mutation-criteria/00-verify-directive-only-mutation-criteria.md` (or an equivalent fixture) and asserts `hollow` is empty.
- [ ] `mutation-checkpoint-verifier.test.ts` — `string literals containing @mutate produce no unparseable entries` proves a pinning test with `@mutate` inside a string literal yields zero `unparseable` rows.
- [ ] `write.test.ts` — `unparseable linked to a ticked criterion refuses completion` proves `spec.criteria-ticked` returns `contract_miss` with criterion text, raw reference, and reason when verification reports `unparseable`; it fails against the stderr-only path.
- [ ] `mutation-checkpoint-verifier.test.ts` — `prose @mutate without a directive-shaped occurrence is not selected`; Mutation checkpoint: its regression carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts "DIRECTIVE_PATTERN.test(markerSource)" -> "markerSource.includes(DIRECTIVE_MARKER)"` (revert to bare-substring selection); reverting the real selection guard turns the named pin red.
- [ ] `write.test.ts` — `unparseable linked to a ticked criterion refuses completion`; Mutation checkpoint: its regression carries `// @mutate v2/src/execution/write.ts "report.unparseable.length === 0" -> "true"` (remove the unparseable-fails gate); reverting that guard turns the named pin red.
- [ ] `v2/docs/operator-runbook.md` § Gate trust states phrase marker unchanged, bare `@mutate` prose no longer selects, directive-shaped `@mutate` still selects, and unparseable now blocks completion.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria states phrase or directive-shaped `@mutate` selection and that bare `@mutate` prose mentions are safe.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — narrowed selection and blocking unparseable.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — directive-shaped selection and safe prose mentions.
