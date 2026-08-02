# Verify directive-only mutation criteria

## Problem

- A ticked non-human criterion quoting `@mutate` without `Mutation checkpoint:` bypasses mutation verification.
- The bypass can accept a hollow source-mutation claim while the scoped suite remains green.

## Decisions

- Select ticked non-human criteria containing `Mutation checkpoint:` or `@mutate` — rules out the current phrase-only selector and broad matching on words such as “mutation.”
- Send directive-selected criteria through the existing resolve, apply, scoped-test, classify, and restore path — rules out a weaker directive-only contract.
- Preserve directive syntax, pin resolution, phrase-selected behavior, and scoped-run lifecycle — rules out verifier redesign in this patch.
- Keep code, regression coverage, and the three required durable-doc updates in one execution-loop subspec — rules out independently landing docs that misstate the active completion gate.

## Tasks

- Broaden mutation-checkpoint criterion selection to admit the phrase or directive marker.
- Extend `mutation-checkpoint-verifier.test.ts` with directive-only caught and hollow cases, marker-boundary cases, and a source-mutation pin for the selector guard.
- Update the operator gate contract, authoring guidance, and v1-behavior catalog.
- Run the required typecheck and v2 test scopes.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `directive-only criteria receive caught and hollow verification` proves a ticked directive-only criterion is refused with `path:line` directive coordinates when its mutation leaves the scoped suite green and accepted when the mutation turns the suite red; it fails against the pre-fix phrase-only selector.
- [ ] `mutation-checkpoint-verifier.test.ts` — `a ticked criterion linking no directive is hollow and names the required form` stays green, proving phrase-only prose with no linked directive remains refused.
- [ ] `mutation-checkpoint-verifier.test.ts` — `criteria without either marker are ignored` proves a ticked criterion containing neither marker remains ignored, including prose using the word “mutation.”
- [ ] `mutation-checkpoint-verifier.test.ts` — `directive-only criteria receive caught and hollow verification`; Mutation checkpoint: the regression carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts "criterion.text.includes(CRITERION_MARKER) || criterion.text.includes(DIRECTIVE_MARKER)" -> "criterion.text.includes(CRITERION_MARKER)"`; reverting the real selection guard to phrase-only turns the named pin red, with no production invert hook.
- [ ] `v2/docs/operator-runbook.md` § Gate trust states that ticked non-human criteria are selected by `Mutation checkpoint:` or a quoted `@mutate` directive and receive the same verification contract.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria states the same authoring contract while retaining directive syntax and phrase-only refusal semantics.
- [ ] `v2/docs/v1-behaviors.md` records the broadened v2 completion-verification selector and unchanged resolve/apply/scoped-red contract.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — operator-visible selection uses the phrase or quoted directive marker.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — authoring may key selection with either marker; a phrase without a linked directive is still refused.
- `v2/docs/v1-behaviors.md` — catalog the changed v2 completion-verification behavior.
