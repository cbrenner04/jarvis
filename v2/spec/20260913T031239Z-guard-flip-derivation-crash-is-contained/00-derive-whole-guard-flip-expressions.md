# Derive whole guard-flip expressions with TypeScript syntax

## Problem

Guard-flip derivation regex-matches only `!identifier` from a negated member/call chain such as `!CONSUMER_FILES.has(file)`, so the candidate identity and audited mutation text name only `!CONSUMER_FILES` — a strict subset of the boolean expression the verifier actually mutates. That mis-slice doesn't by itself explain the evidenced crash: `!CONSUMER_FILES` is a literal substring of the changed line, so it slice-verifies and applies cleanly, just to the wrong (narrower) expression. The evidenced `Failed to test candidate` failure was a containment gap the base has since closed — `applyMutation`'s `UnappliableMutationError` and `testCandidate`'s catch already turn a slice-verify mismatch into a skipped candidate. This subspec fixes the remaining derivation defect (incomplete candidate identity/audit text) and adds regression coverage confirming the containment that resolved the crash actually holds, rather than assuming it.

## Surface

Diff-derived guard candidate classification and its co-located regressions; durable mutation-verifier architecture, parity, and operator guidance. Operator-flip behavior, destructive-operation derivation, killing-test/render-coverage resolution, and downstream write-loop settlement are out of scope.

## Decision ledger

- Classify `!` prefix-unary expressions from the reconstructed full TypeScript source and use the complete unary-expression span as `originalText`; rules out widening the guard regex or retaining a partial member/call-chain identity.
- Admit a guard only when its `!` token is on a changed physical line and its complete AST span fits that line; rules out knowingly emitting an unappliable partial span under the line-scoped candidate model.
- Emit only the outermost `!` prefix-unary node for a chained negation such as `!!x`; do not also emit its negated operand as a second candidate; rules out double-counting one logical toggle as two overlapping candidates with divergent span, budget, and ordering impact.
- Preserve guard-before-operator ordering and candidate identity deduplication after moving guard classification beside operator classification; rules out AST traversal order changing inspection priority or budget use.
- Keep destructive-operation derivation on its existing masked-line regex and leave operator-flip classification unchanged; rules out an unevidenced rewrite of adjacent mutation families.
- Keep `UnappliableMutationError` containment narrow across the sole base `applyMutation` call while genuine write/test infrastructure errors still surface; rules out downstream recovery changes or swallowing arbitrary candidate failures.
- Deferred to first consumer: multi-line negated-expression mutation — pin when a caller needs it; rules out expanding the line-slice application model without an evidenced case.

## Tasks

- Replace regex guard derivation with TypeScript AST classification over reconstructed current source, retaining changed-line admission, source columns, guard-first ordering, and deduplication.
- Derive the complete single-line negated expression, including member/call chains and parenthesized operands, without creating partial or unappliable candidates.
- Audit every base call to `applyMutation`; preserve the existing typed skip path or contain any uncovered application path without broadening infrastructure-error handling.
- Add focused derivation and containment regressions.
- Update docs per **Documentation updates**.

## Acceptance criteria

- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` gains regression `derives guard-flip for a negated member-call chain`, which verifies `!CONSUMER_FILES.has(file)` produces `guard-flip: !CONSUMER_FILES.has(file) → CONSUMER_FILES.has(file)`, applies that exact whole-expression slice, and is not skipped; it fails against the pre-fix partial-identity derivation.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` gains regression `derives guard-flip for a nested parenthesized operand`, which verifies `!(a && (b || c.has(d)))` produces one guard candidate spanning the whole parenthesized expression, mutating to `(a && (b || c.has(d)))`; it fails against the pre-fix regex derivation.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` gains regression `collapses double negation to one guard candidate`, which verifies `!!x` on a changed line produces exactly one guard candidate spanning `!!x` and mutating to `!x`, not two overlapping candidates; it fails against the pre-fix regex derivation.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` gains regression `respects line-scoped guard admission boundaries`, which proves a negated expression on an unchanged line yields no guard candidate, a negated expression whose AST span crosses multiple lines yields no candidate and no partial span, and guard-first ordering with deduplication is preserved when a guard and an operator candidate share a changed line; it fails against the pre-fix regex derivation.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` gains regression `classifies guard-flips with TypeScript lexical context`, which excludes negation text in comments, strings, and template literal text — including on a changed continuation line inside an already-open multi-line block comment or template literal — while retaining a negated expression inside a template substitution; it fails against the pre-fix masked-line derivation.
- [x] The `unappliable candidate containment` describe block in `v2/src/execution/diff-derived-mutation-verifier.test.ts` — covering skip diagnostics for slice mismatch and propagation of genuine seam failures, and confirming the evidenced `Failed to test candidate` crash path is contained on the base rather than assumed — stays green after the sole `applyMutation` call site is audited.
- [x] The operator-classification and non-code masking tests in `v2/src/execution/diff-derived-mutation-verifier.test.ts` stay green (adjacent mutation-family behavior remains unchanged).
- [x] `v2/docs/workflow-runner.md` documents full-source TypeScript classification for single-line negated expressions, complete member/call-chain spans, lexical-context behavior, and unchanged guard-first ordering.
- [x] `v2/docs/v1-behaviors.md` records whole-expression TypeScript guard classification and unappliable-candidate containment in the v2 mutation-verification baseline.
- [x] `v2/docs/operator-runbook.md` removes the resolved guard-flip residual warning while retaining unappliable-candidate skip guidance.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — replace masked-line guard classification with full-source TypeScript unary-expression classification and its single-line span contract.
- `v2/docs/v1-behaviors.md` — align the v2 parity baseline with whole-expression guard candidates and retained skip containment.
- `v2/docs/operator-runbook.md` — remove the resolved slice-bug cross-reference; keep the operational skip behavior.
