# Lean inline doc-comment default

`v2/docs/documentation-standard.md`'s inline standard currently mandates a full
contract block (purpose, params, returns, errors, invariants) on every export.
That's overkill for exports whose contract is already evident from name and
type signature — those need no comment at all — and it invites restating
types or narrating the body instead of adding information the code can't
express itself.

## Decisions

- An export evident from name + type gets no doc-comment at all — rules out requiring a one-liner on every export regardless of triviality.
- A one-liner is written only when the export carries exactly one non-obvious fact worth stating (what it's for, when that's not evident from name + type) — rules out a one-liner-by-default that restates the evident.
- Full contract block (params, returns, `@throws`, `@invariant`) is reserved for genuinely non-obvious contracts (hidden preconditions, thrown errors, invariants a signature can't convey) — rules out treating the block as the default shape.
- Restating parameter/return types in prose, or narrating what the body does line-by-line, is explicitly forbidden — rules out doc-comments that duplicate the type checker or the code.

## Task checklist

- [x] Rewrite the "Inline standard" section of `v2/docs/documentation-standard.md` per the decisions above: no comment when evident, one-liner for one non-obvious fact, full block only for genuinely non-obvious contracts.
- [x] Check the rest of `v2/docs/documentation-standard.md` (e.g. the placement table's "Single symbol contract" row) for content assuming the old full-contract-block default, and update it to match the new tiering.
- [x] Merge the new "don't narrate bodies" wording with the doc's existing "comment why, not what" / "do not narrate obvious code" guidance rather than duplicating it.
- [x] Add 2-3 worked examples contrasting: evident (no comment), one non-obvious fact (one-liner), genuinely non-obvious contract (full block).

## Acceptance criteria

- [x] `v2/docs/documentation-standard.md`'s inline standard states: no doc-comment when the contract is evident from name/type; a one-liner only for one non-obvious fact; a full contract block only for genuinely non-obvious contracts (hidden preconditions, thrown errors, invariants).
- [x] It explicitly forbids restating types and narrating bodies, without duplicating the doc's existing why-not-what guidance.
- [x] The doc contains no remaining content implying every export needs a full contract block by default (e.g. the placement table is consistent with the new tiering).
- [x] The doc includes worked examples for the evident / one-liner / full-block cases.

## Documentation updates

- `v2/docs/documentation-standard.md` inline standard section rewritten (this is the deliverable).
