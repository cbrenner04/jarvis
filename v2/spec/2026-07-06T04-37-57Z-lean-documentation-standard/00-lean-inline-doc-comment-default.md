# Lean inline doc-comment default

`v2/docs/documentation-standard.md`'s inline standard currently mandates a full
contract block (purpose, params, returns, errors, invariants) on every export.
That's overkill for exports whose contract is already evident from name and
type signature, and it invites restating types or narrating the body instead
of adding information the code can't express itself.

## Decisions

- Default doc-comment is one line: what the export is for, only when that's not evident from name + type — rules out mandating a full contract block on every export regardless of triviality.
- Full contract block (params, returns, `@throws`, `@invariant`) is reserved for genuinely non-obvious contracts (hidden preconditions, thrown errors, invariants a signature can't convey) — rules out treating the block as the default shape.
- Restating parameter/return types in prose, or narrating what the body does line-by-line, is explicitly forbidden — rules out doc-comments that duplicate the type checker or the code.

## Task checklist

- [ ] Rewrite the "Inline standard" section of `v2/docs/documentation-standard.md` per the decisions above.

## Acceptance criteria

- [ ] `v2/docs/documentation-standard.md`'s inline standard states one-line-per-export as the default, scoped to contracts not evident from name/type.
- [ ] It states that full contract blocks (params/returns/`@throws`/`@invariant`) are reserved for genuinely non-obvious contracts.
- [ ] It explicitly forbids restating types and narrating bodies.

## Documentation updates

- `v2/docs/documentation-standard.md` inline standard section rewritten (this is the deliverable).
