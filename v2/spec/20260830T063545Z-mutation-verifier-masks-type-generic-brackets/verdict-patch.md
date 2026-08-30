Reviewing the implementation and docs against the spec to issue an independent verdict.
## Verdict

### Upheld issues

1. **Operator-facing docs overclaim masking coverage.** `workflow-runner.md` and `v1-behaviors.md` enumerate covered forms (including “call-site type params”) that read broader than `maskTypePositionAngleBrackets` delivers. Colon-prefixed call-signature generics (`const f: <T>(x: T) => T`, `interface I { <T>(x: T): void }`) are not masked and can still produce the same `surviving_mutation_failed` false positive as the filed incident, yet they are neither pinned nor listed as residual risks.

2. **Residual-risk lists are incomplete.** The subspec and doc acceptance criteria require fixture-bounded masking with named residual risks consistent with existing masking caveats. Docs name nested-generic depth, old-style assertions, and TSX/JSX, but omit two real, fail-safe limitations of this heuristic: colon/`{`-prefixed call-signature type annotations, and comparison over-mask when `<` immediately follows an identifier with no whitespace (e.g. `a<b` beside `Map<string>`).

3. **Core implementation and pinned fixtures are sound.** The incident line, five pinned type-only shapes, mixed-line spaced comparison preservation, operator-flip-only scoping, and post-`maskNonCodeSpans` ordering meet the subspec. Old-style assertions, TSX/JSX, optional `test-writing.md` cross-link, total-`candidateCount` test style, and invalid-syntax mixed-line fixture are acceptable for this slice.

### Required outcomes

1. **Align both durable docs with actual heuristic bounds.** In `v2/docs/workflow-runner.md` and `v2/docs/v1-behaviors.md`, describe covered type-position masking as fixture-bounded / pinned to the forms exercised in tests (identifier-adjacent generics, `as`/`satisfies`, `new` type args, `=<Identifier` arrow generic params, declaration/call-site identifier-adjacent `<T>`). Remove or narrow wording that implies colon-prefixed call-signature or interface-member generics are excluded unless the heuristic is extended to cover them.

2. **Add missing residual risks to both docs.** Extend the fail-safe limitation list to include: (a) colon- or brace-prefixed call-signature type annotations, and (b) unspaced comparisons immediately after an identifier token (`a<b`), which the adjacency rule deliberately drops to preserve spaced `a < b` beside generics.

3. **No implementation change required for this slice** unless docs are tightened by extending coverage instead — call-signature annotations were not pinned or incident-derived; documenting them as residual risk satisfies the subspec’s “deferred to first consumer” boundary. Do not block ship on heuristic extension, test-style polish, or optional cross-links.

### Rationale

The patch fixes the filed false positive and satisfies pinned acceptance criteria. The remaining gap is documentation fidelity: operator-facing text must not imply broader exclusion than the lexer delivers, and known fail-safe holes must be named alongside existing regex/template/TSX caveats — that is explicit subspec and doc-AC scope, not optional follow-up.