# 00 - Reconcile prompt schema and ship layered rendering

## Decisions

- Keep one slice: schema reconciliation, layered rendering, snapshot updates, and durable doc alignment share one prompt-contract surface and one first consumer.
- Durable contract home: `v1/docs/prompt-governance.md`.
- Historical context home: `v2/docs/prompts.md`; align it to the shipped contract and cross-link the v1 doc.
- Scope only the first rollout artifacts already in the registry; exclude `plan/name-only.md` and `plan/inline-draft.md`.
- Replace `kind: template|rules` with `kind: step|fragment` everywhere; no compatibility alias layer.
- Make `behavior` the real grouping field on non-global artifacts; do not store `agent-facing`.
- Deferred to first consumer: exact field shape for the global marker — pin when the renderer/registry implementation chooses the least-invasive form.
- Treat `plan.decisions-ledger` and `plan.defer-to-consumer` as plan behavior fragments, not globals.
- Keep chooser and confirmation strings runtime-owned and out of registry scope.
- Keep runtime lookup and composition keyed by prompt `id`; file path and legacy directory taxonomy stay non-contractual.
- Pick one placeholder contract and use it in docs, parser, prompt files, fixtures, and tests; no dual-format acceptance.
- Reconcile placeholder delimiter syntax in the same slice; either docs adopt shipped `<NAME>` syntax or runtime, files, and tests migrate together.
- Keep `patch.rules` step-owned injected body content unless the concrete layered `patch.prompt.body` consumer requires fragment semantics.
- Ship metadata-driven composition; callers render by step `id` plus placeholder values, not explicit fragment lists.
- Preserve validation split: metadata and relationship errors fail registry load; unknown runtime IDs and placeholder-value errors fail at render time.
- Preserve shipped fragment order unless `patch.prompt.body` needs a different assembled output: patch `global.documentation -> global.naming -> global.terse`; plan `global.documentation -> global.terse -> plan.decisions-ledger -> plan.defer-to-consumer`.
- Bump `revision` only for artifact IDs whose rendered output changes; metadata-only relabels that keep rendered bytes identical do not bump.

## Work items

- Update prompt source frontmatter, registry parsing, and validation in `v1/src/prompts/registry.ts` and registered prompt files to the reconciled schema.
- Implement layered renderer behavior in `v1/src/prompts/renderer.ts` for deterministic `global -> behavior -> step` assembly plus step `add` and `remove`.
- Make `patch.prompt.body` the first concrete layered consumer without expanding rollout inventory.
- Update `v1/test/prompts/registry.test.ts`, `v1/test/prompts/renderer.test.ts`, and rendered snapshot fixtures to assert the reconciled schema, validation split, layered output, and revision policy.
- Update `v1/docs/prompt-governance.md` to the canonical shipped schema, delimiter, placeholder, renderer, revision, and validation contract.
- Update `v2/docs/prompts.md` to historical-context status only, removing alternate live-contract wording and linking back to the v1 canonical contract.

## Documentation updates

- `v1/docs/prompt-governance.md`: shipped prompt schema, layering semantics, placeholder contract, delimiter syntax, revision policy, validation split, rollout inventory.
- `v2/docs/prompts.md`: historical design context, explicit supersession notes, cross-links to `v1/docs/prompt-governance.md`.
- No other durable doc updates unless implementation changes another operator-facing prompt workflow contract.

## Acceptance criteria

- [ ] Registered first-rollout prompt artifacts use one reconciled schema in source, parser, and tests: `kind: step|fragment`, real behavior grouping, one placeholder format, and one delimiter contract; no stored `agent-facing`, `template`, `rules`, or active dual placeholder parsing remain in rollout scope.
- [ ] Rendering a step by prompt `id` assembles `global -> behavior -> step` deterministically, honors step `add` and `remove`, and uses artifact metadata rather than caller-supplied fragment lists; `patch.prompt.body` renders through this path as the first concrete consumer.
- [ ] `v1/test/prompts/registry.test.ts`, `v1/test/prompts/renderer.test.ts`, and rendered snapshot coverage assert the reconciled schema, validation boundary, layered output, and revision bumps only for IDs whose rendered bytes changed.
- [ ] `v1/docs/prompt-governance.md` is the canonical shipped contract for schema, renderer, placeholders, delimiters, validation, revisions, and rollout scope; `v2/docs/prompts.md` no longer states an alternate live contract.
