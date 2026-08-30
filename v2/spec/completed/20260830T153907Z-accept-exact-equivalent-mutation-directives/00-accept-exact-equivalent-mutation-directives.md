# Accept exact equivalent-mutation directives

## Problem

Diff-derived mutation verification blocks a correct implementation when a generated mutation is provably behavior-neutral and every co-located test therefore stays green. The verifier has no auditable escape hatch, so the operator must add a vacuous killing test or strand the run.

## Surface

Diff-derived mutation verification in `v2/src/execution/diff-derived-mutation-verifier.ts`; verifier regressions, durable workflow/operator docs, the v1 behavior catalog, and the dependent implement-loop seed. Prompt render coverage, mutation-repair lifecycle wiring, and downstream logging or persistence are out of scope.

## Decision ledger

- Recognize only a lexical `//` line comment on the candidate's original physical source line whose entire body is exactly one ASCII space followed by `@mutate-equivalent mutation=<JSON string> reason=<JSON string>`: `mutation` first, one ASCII space before `reason`, no whitespace outside the JSON strings beyond those delimiters, and no trailing text or duplicate fragments. Parse both values as complete standard JSON strings, require exact full mutation equality and a decoded reason containing non-whitespace text; rules out reason-only comments, alternate placement, reordered fields, parser-dependent escaping, directive-like strings/templates/regexes/block comments, and empty or whitespace-only justifications.
- Check an exact directive before co-located killing-test resolution and execution; rules out requiring or running a vacuous test for an accepted candidate.
- Match acceptance by candidate file, physical line, and full verifier-generated mutation string. A directive cannot select an individual occurrence when the verifier emits duplicate candidates with that same identity on one line, so it accepts that indistinguishable identity group jointly; candidates with a different mutation remain independent and blocking. Rules out file-wide, cross-line, and all-distinguishable-candidates-on-one-line suppression.
- Treat malformed, incomplete, reordered, duplicate, trailing, non-line-comment, empty/whitespace-reason, and mutation-mismatched directives as absent and continue normal verification; rules out fail-open annotation parsing.
- Return `acceptedSites` on every verifier pass result, including `[]` when none are accepted. It contains one de-duplicated `{ file, line, mutation, reason }` entry per accepted identity, in candidate-discovery order; rules out downstream source rescanning with another parser and ambiguous audit ordering.
- An accepted candidate is inspected and consumes one `MAX_INSPECTED_MUTATIONS` slot; `candidateCount` is the number of candidates admitted before the candidate limit or deadline, whether accepted or tested. A candidate is admitted only while both bounds remain open, and `acceptedSites` is complete for that admitted subset only; rules out annotations silently expanding the bounded scan or claiming audit completeness for uninspected candidates.
- Apply the directive only to derived code candidates; rules out suppressing registered-prompt render coverage with source-comment syntax.
- Require non-whitespace text mechanically; operator guidance separately requires that text to be a substantive explanation. Prefer cheap code restructuring before an equivalence directive, and reserve the directive for provably behavior-neutral irreducible candidates; rules out annotation as the default response to surviving mutations.
- Expose structured pass-result evidence only; this change does not prescribe downstream lifecycle logging or publication.

## Tasks

- Extend `v2/src/execution/diff-derived-mutation-verifier.ts` to lex and parse the exact directive from each candidate's original line, accept only its matching identity before killing-test lookup, account accepted candidates against the existing bounds, and include ordered de-duplicated accepted-site audit details on every pass result.
- Add focused regressions in `v2/src/execution/diff-derived-mutation-verifier.test.ts` for exact JSON parsing and audit output, absent killing tests, malformed or mismatched directives, comment-context recognition, file and line isolation, identity-group behavior, multiple candidates and multiple accepted sites, no-acceptance pass shape, and candidate-limit/deadline accounting.
- Update `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, and `v2/spec/seeds/implement-verifies-mutations-in-loop.md` as listed below.

## Acceptance criteria

- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` regression `accepts an exact equivalent-mutation directive and reports its audit site` places the exact directive on a changed guard, exercises standard JSON escaping, receives a pass containing the accepted file, line, full mutation, and decoded non-whitespace reason without running a killing test, and fails against the pre-fix verifier that reports the candidate as surviving or missing a killing test.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` regressions prove malformed JSON, reordered fields, extra whitespace, trailing text, duplicate fragments, an empty or whitespace-only decoded reason, and a directive naming another full mutation string are absent and leave the candidate blocking; they fail against any fail-open or mutation-insensitive implementation.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` regressions prove directive-like text in a string, template, regex, or block comment is not recognized, while the exact lexical line comment is; the candidate remains blocking for every non-comment form.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` regressions prove a matching directive does not accept the same mutation string generated on another physical line or in another file at the same physical line; each isolated candidate remains blocking.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` regression derives multiple candidates from one annotated line and proves only the named different transform is accepted while the other is still tested and blocks when it survives; a separate duplicate-identity regression proves duplicate candidates with the same file, line, and mutation are accepted jointly and produce one audit entry because the directive cannot distinguish their occurrences.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` regressions prove every pass result exposes `acceptedSites`, uses `[]` when no candidate is accepted, and reports multiple accepted identities once each in candidate-discovery order.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` regressions prove accepted candidates consume `MAX_INSPECTED_MUTATIONS`, contribute to `candidateCount`, and are omitted from `acceptedSites` when the candidate limit or deadline prevents admission; the reported audit list is complete for the admitted candidates.
- [x] `v2/docs/workflow-runner.md` documents the directive's executable exact syntax and JSON escaping, lexical-line-comment-only recognition, exact identity and duplicate-identity scope, fail-closed behavior, bounded accepted-site pass evidence, code-candidate-only scope, restructure-first ordering, and that downstream publication is outside this change.
- [x] `v2/docs/operator-runbook.md` documents recovery for a genuine equivalent mutation: remove cheap redundancy first, otherwise add the exact colocated directive with a substantive reason, and never add a vacuous killing test.
- [x] `v2/docs/v1-behaviors.md` records that v2 completion mutation verification accepts exact audited equivalent-mutation directives while malformed or mismatched directives remain blocking.
- [x] `v2/spec/seeds/implement-verifies-mutations-in-loop.md` replaces the reason-only placeholder with the exact `@mutate-equivalent` grammar, lexical-comment recognition, exact identity including duplicate-identity behavior, JSON escaping, bounds-aware accepted-site audit contract, and non-whitespace reason rule.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — executable directive grammar, JSON escaping, lexical-comment recognition, exact identity including duplicate-identity scope, fail-closed behavior, bounded accepted-site pass evidence, code-candidate scope, restructure-first guidance, and no prescribed downstream publication.
- `v2/docs/operator-runbook.md` — equivalent-mutation recovery ordering and prohibition on vacuous killing tests.
- `v2/docs/v1-behaviors.md` — changed v2 completion-verification behavior.
- `v2/spec/seeds/implement-verifies-mutations-in-loop.md` — replace the reason-only placeholder with the pinned exact-mutation directive contract, including bounds and audit collection semantics.
