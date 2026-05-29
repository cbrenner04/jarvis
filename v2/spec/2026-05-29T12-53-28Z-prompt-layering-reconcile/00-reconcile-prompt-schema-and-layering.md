# 00 - Reconcile prompt schema and ship layered rendering

## Decisions

- Keep one slice: schema reconciliation, layered rendering, snapshot updates, and doc alignment share one prompt-contract surface and one first consumer.
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

- Reconcile rollout prompt frontmatter, registry parsing, and validation to the shipped schema.
- Implement deterministic `global -> behavior -> step` rendering with step `add` and `remove`.
- Route `patch.prompt.body` through the layered renderer as the first consumer.
- Update registry, renderer, and rendered snapshot coverage for schema, layering, validation split, and per-ID revision policy.
- Align `v1/docs/prompt-governance.md` as canonical and `v2/docs/prompts.md` as historical context.

## Documentation updates

- `v1/docs/prompt-governance.md`: shipped schema, layering, placeholders, delimiters, validation, revisions, rollout scope.
- `v2/docs/prompts.md`: historical context, supersession note, cross-link to `v1/docs/prompt-governance.md`.
- No other durable doc updates unless implementation changes another operator-facing prompt workflow contract.

## Acceptance criteria

- [ ] Rollout prompt artifacts, parser, and tests use one schema: `kind: step|fragment`, real behavior grouping, one placeholder format, and one delimiter contract; no stored `agent-facing`, `template`, `rules`, or active dual placeholder parsing remain in scope.
- [ ] Rendering a step by prompt `id` assembles `global -> behavior -> step`, honors step `add` and `remove`, and uses artifact metadata rather than caller-supplied fragment lists; `patch.prompt.body` is the first consumer.
- [ ] Registry, renderer, and rendered snapshot coverage assert the schema, validation split, layered output, and per-ID revision bumps only where rendered bytes changed.
- [ ] `v1/docs/prompt-governance.md` is the canonical shipped contract; `v2/docs/prompts.md` no longer states an alternate live contract.
