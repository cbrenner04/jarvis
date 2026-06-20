# Structural validation in the draft gate

## Problem

`validateDraftOutput` checks index.md existence, numbered-subspec presence, intent immutability, and blocker ordering — but never opens the generated subspecs. A draft can ship a `### Acceptance criteria` heading (silently unparseable by patch mode), a second `## Acceptance criteria` block (whose criteria the first-occurrence parser ignores), or a pure-structural AC, and the gate passes. These rules live only in the draft prompt.

This subspec moves them into the harness gate, reading each generated subspec through the shared spec parser.

## Decisions

- Validate every generated `NN-*.md`, not just `index.md`. Rules out the current index-only gate.
- Reuse `shared/spec-parser.ts` for heading and AC extraction. Rules out a plan-only parser that diverges from patch ticking.
- Keep the blocker short-circuit first: when `intent.md` carries a genuine `## Blocker`, no subspecs are expected, so structural checks do not run. Rules out failing a valid blocker stop for absent subspecs.
- Near-miss acceptance/blocker heading (e.g. `### Acceptance criteria`, `## acceptance criteria`) → **fail** (`valid: false`). The parser already emits these as warnings; the draft gate promotes them to a hard failure. Rules out shipping a subspec patch mode cannot parse.
- Duplicate canonical section — `## Acceptance criteria` or `## Blocker` appearing more than once in one subspec → **fail**. The parser takes the first occurrence, so a second block's criteria are invisible to patch-mode ticking; that is a correctness hazard, not a style nit. Rules out warn-only acceptance of duplicate blocks.
- Coarse structural-AC check → **warning** (non-blocking; surfaced on stderr, draft still commits). Pins the intent's deferred severity. Rationale: the check is a coarse keyword/shape heuristic and harness subspecs legitimately name internal structure (structure-is-the-contract), so a hard fail would block valid drafts. Rules out fail.
- `validateDraftOutput` returns a non-blocking `warnings` channel distinct from `error`; warnings print to stderr without setting `valid: false`. Rules out overloading `error` (which forces exit 1).

Coarse keyword/shape heuristic for "structural AC": exact phrase set pinned at implementation.

## Task checklist

- [ ] Add duplicate canonical-heading detection to `shared/spec-parser.ts` (repeated `## Acceptance criteria` / `## Blocker`).
- [ ] Add a coarse structural-AC classifier (helper over parsed ACs).
- [ ] Extend `validateDraftOutput` to read each `NN-*.md`, fail on near-miss heading or duplicate canonical section, warn on structural AC, and return a `warnings` channel.
- [ ] Surface `validateDraftOutput` warnings on stderr at the call site in `v1/src/commands/plan.ts` before the draft commit.
- [ ] Add tests covering near-miss headings, duplicate sections, structural ACs, and a clean valid draft.

## Acceptance criteria

- [ ] `validateDraftOutput` returns invalid (blocking the `plan: draft` commit) when a generated subspec uses a near-miss acceptance or blocker heading (`### Acceptance criteria`, `## acceptance criteria`, `## Blocker ` variants).
- [ ] `validateDraftOutput` returns invalid when a generated subspec contains a duplicate canonical section (two `## Acceptance criteria` or two `## Blocker` headings).
- [ ] An AC naming only implementation structure produces a non-blocking warning surfaced on stderr; the draft still commits.
- [ ] A valid draft — exact `## Acceptance criteria` heading, single canonical sections, behavioral ACs — passes validation and commits.
- [ ] Heading and AC extraction route through `shared/spec-parser.ts`; no plan-only parser is added.
- [ ] A genuine `## Blocker` in `intent.md` still short-circuits to a valid stop without running structural subspec checks.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: draft-validation section — list the harness-enforced structural rules (heading exactness fail, duplicate-section fail, structural-AC warning) and that they run per generated subspec before the draft commit.
- `v2/docs/v1-behaviors.md`: extend the draft-validation-order entry (currently blocker → index → subspecs) with the per-subspec structural checks and their severities.
