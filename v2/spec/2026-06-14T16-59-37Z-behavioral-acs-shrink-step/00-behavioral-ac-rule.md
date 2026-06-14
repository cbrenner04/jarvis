# 00 - Behavioral acceptance-criteria rule

ACs that describe structure make the structure mandatory downstream:
`"migrations forward-only and idempotent (test)"` produced a 72-line migration
ledger over three idempotent `CREATE TABLE IF NOT EXISTS` statements; `"no
duplicate outcome row"` produced a 1:1 table. This is the plan-loop
precision-amplifier failure surfacing at write time. Fix the authoring surface:
ACs state observable behavior and stay silent on schema/tables/files/shapes —
unless the structure *is* the contract (a public API, a wire format).

## Decisions

- Rule lands in two surfaces: `v1/docs/spec-guidance.md` (operator guidance) and
  the plan-mode draft prompts (`prompts/plan/draft.md`, `prompts/plan/inline-draft.md`) — rules out doc-only, which leaves the generating agent un-instructed.
- Bump `revision` in `prompts/plan/draft.md` frontmatter when editing its body — registry convention; rules out a silent stale-revision edit.
- Add the rule alongside the existing self-referential-AC rule in each draft prompt's `## Rules` block — rules out a new scattered section.
- Add a `v2/docs/v1-behaviors.md` entry because changing draft prompt guidance changes observable `jarvis1 plan` output — rules out leaving the v1 parity catalog stale.

## Task checklist

- [x] Add the behavioral-AC rule to `v1/docs/spec-guidance.md` near the subspec / acceptance-criteria guidance.
- [x] Add the same rule to the `## Rules` block of `prompts/plan/draft.md` (bump `revision`) and `prompts/plan/inline-draft.md`.
- [x] Update `v2/docs/v1-behaviors.md` for the plan authoring behavior change.
- [x] Run typecheck and prompt tests.

## Acceptance criteria

- [x] `v1/docs/spec-guidance.md` instructs that acceptance criteria state observable behavior and stay silent on schema, tables, files, and shapes unless the structure is itself the contract (public API or wire format).
- [x] `prompts/plan/draft.md` and `prompts/plan/inline-draft.md` each carry that behavioral-AC authoring rule.
- [x] `prompts/plan/draft.md` has its `revision` bumped and rendered prompt fixtures updated.
- [x] `v2/docs/v1-behaviors.md` records the changed plan authoring behavior.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/spec-guidance.md`: the behavioral-AC rule (this is the doc change itself).
- `v2/docs/v1-behaviors.md`: record the plan authoring behavior change.
