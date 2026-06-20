# Structural validation in the draft gate

## Problem

`validateDraftOutput` checks index.md existence, numbered-subspec presence, intent immutability, and blocker ordering — but never opens the generated subspecs. A draft can ship a `### Acceptance criteria` heading (silently unparseable by patch mode), a second `## Acceptance criteria` block (whose criteria the first-occurrence parser ignores), a subspec with no parseable `## Acceptance criteria` section at all (index never completes at run time), or a pure-structural AC, and the gate passes. These rules live only in the draft prompt.

This subspec moves them into the harness gate, reading each generated subspec through the shared spec parser.

## Decisions

- Validate every generated `NN-*.md`, not just `index.md`. Rules out the current index-only gate.
- Reuse `shared/spec-parser.ts` for heading and AC extraction. Rules out a plan-only parser that diverges from patch ticking.
- Keep the blocker short-circuit first: when `intent.md` carries a genuine `## Blocker`, no subspecs are expected, so structural checks do not run. Rules out failing a valid blocker stop for absent subspecs.
- Near-miss acceptance/blocker heading (e.g. `### Acceptance criteria`, `## acceptance criteria`) → **fail** (`valid: false`). The parser already emits these as warnings; the draft gate promotes them to a hard failure. Rules out shipping a subspec patch mode cannot parse.
- Duplicate canonical section — `## Acceptance criteria` or `## Blocker` appearing more than once in one subspec → **fail**. The parser takes the first occurrence, so a second block's criteria are invisible to patch-mode ticking; that is a correctness hazard, not a style nit. Rules out warn-only acceptance of duplicate blocks.
- Missing/empty acceptance section — a subspec exposing zero parseable criteria under the exact `## Acceptance criteria` heading → **fail**. An unparseable subspec never completes at run time, the exact failure class this gate exists to close. Rules out passing a subspec the index can never tick.
- Parser → gate severity contract: the parser returns **categorized** warnings (a discriminated `kind`, e.g. `near-miss-acceptance-heading`, `near-miss-blocker-heading`, `duplicate-section`), not free prose. The gate maps category → severity (near-miss/duplicate → fail; structural-AC → warn) by `kind`. Rules out the gate string-matching parser prose, which is fragile and breaks on message wording changes.
- Structural-AC classifier rule (the discriminating shape, tokens deferred): an AC is "structural" when its predicate is a **location/containment/existence claim about code structure** — head verb of the location/existence family ("lives in", "is defined in", "exists as", "has unit tests") with no observable runtime/operator outcome clause. → **warning** (non-blocking; surfaced on stderr, draft still commits). Pins the intent's deferred severity. Rules out fail.
- The classifier keys on location/existence predicates, **not** mere presence of a symbol/path token. Trade-off owned: a coarse symbol/keyword-presence classifier was rejected — it misfires on the legitimate harness pattern of ACs that name a symbol as the *subject* of a behavioral assertion (including this subspec's own ACs naming `validateDraftOutput`), and an AC channel that fires on most valid harness ACs trains the operator to ignore it, dulling subspec 01's anchor warning that shares the channel. Rules out the keyword-presence approach.
- `validateDraftOutput` returns a non-blocking `warnings` channel distinct from `error`; warnings print to stderr without setting `valid: false`. Rules out overloading `error` (which forces exit 1).
- Scope boundary: validation runs only before the draft commit. `plan: review N rM` resume passes can re-introduce malformations and are not re-validated by this gate. Named so the structural guarantee is not assumed to hold post-review. Rules out claiming an always-on structural invariant.

Location/existence verb set and the structural-AC token list: exact forms pinned at implementation.

## Task checklist

- [ ] Add duplicate canonical-heading detection to `shared/spec-parser.ts` (repeated `## Acceptance criteria` / `## Blocker`) and emit it as a categorized (`kind`-tagged) warning alongside the existing near-miss-heading warnings.
- [ ] Add a structural-AC classifier keying on location/existence predicates (helper over parsed ACs).
- [ ] Extend `validateDraftOutput` to read each `NN-*.md`, map categorized parser warnings to severity (near-miss heading / duplicate section → fail), fail on a subspec with no parseable acceptance criteria, warn on structural AC, and return a `warnings` channel.
- [ ] Surface `validateDraftOutput` warnings on stderr at the call site in `v1/src/commands/plan.ts` before the draft commit.
- [ ] Add tests covering near-miss headings, duplicate sections, a subspec with no acceptance section, structural ACs, and a clean valid draft.

## Acceptance criteria

- [ ] `validateDraftOutput` returns invalid (blocking the `plan: draft` commit) when a generated subspec uses a near-miss acceptance or blocker heading (`### Acceptance criteria`, `## acceptance criteria`, `## Blocker ` variants).
- [ ] `validateDraftOutput` returns invalid when a generated subspec contains a duplicate canonical section (two `## Acceptance criteria` or two `## Blocker` headings).
- [ ] `validateDraftOutput` returns invalid when a generated subspec exposes no parseable criterion under the exact `## Acceptance criteria` heading (missing or empty section).
- [ ] An AC whose predicate is a location/existence claim about code structure (e.g. "X lives in a dedicated module with unit tests") produces a non-blocking warning surfaced on stderr; the draft still commits. An AC naming a symbol as the subject of a behavioral assertion (e.g. "`validateDraftOutput` returns invalid when …") produces no structural-AC warning.
- [ ] A valid draft — exact `## Acceptance criteria` heading, single canonical sections, behavioral ACs — passes validation and commits.
- [ ] Heading and AC extraction route through `shared/spec-parser.ts`; the parser emits categorized (`kind`-tagged) warnings and the gate maps category → severity without string-matching parser prose. No plan-only parser is added.
- [ ] A genuine `## Blocker` in `intent.md` still short-circuits to a valid stop without running structural subspec checks.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: draft-validation section — list the harness-enforced structural rules (heading exactness fail, duplicate-section fail, missing-acceptance-section fail, structural-AC warning), that they run per generated subspec before the draft commit, and that they run only at draft time (resume `plan: review N rM` passes are not re-validated).
- `v2/docs/v1-behaviors.md`: extend the draft-validation-order entry (currently blocker → index → subspecs) with the per-subspec structural checks and their severities; record that the `shared/spec-parser.ts` change is additive — duplicate detection and categorized warnings added, first-occurrence ticking behavior preserved (patch-mode parsing unchanged).
