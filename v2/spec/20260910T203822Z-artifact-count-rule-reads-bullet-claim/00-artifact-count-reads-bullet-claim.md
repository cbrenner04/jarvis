# Exempt stays-unchanged and one-decision bullets from the artifact count

## Problem

`assertSingleArtifactBullets` in `shared/module-boundary-surfaces.ts` counts distinct backticked paths per bullet unconditionally. Two well-formed bullet kinds are refused: a stays-green preservation AC naming two existing test files (it builds nothing), and a `## Decisions` bullet naming several call sites governed by one decision. Both settle non-resumable `contract_miss` (`nextAction: inspect_spec`) and cost a hand-landing on an otherwise complete draft — runs `b43f46d5` (#3680, commit `91995f666`) and `06d7f3d4` (#3700, commit `30967b68a`). Neither PR's rejected draft text survives (both were reworded before landing), so the two fixtures below are reconstructed from the landed commit messages and the split/reworded bullets they replaced — the closest available evidence of the exact wording the fix must accept. Both are quoted here rather than in the checked sections below because this very Problem section is exempt from the rule being fixed; the checked sections only name the fixtures by number.

**#3680 fixture** (reconstructed, an Acceptance-criteria bullet): "`v2/src/daemon/pipeline-execution.test.ts` and `v2/src/commands/run.test.ts` missing-gate projections stay green (shape unchanged by the mapping change)."

**#3700 fixture** (reconstructed, a `## Decisions` bullet): "Both `review-cycle.ts` and `review-debate.ts` take the identical resolved path from one builder-local binding; rules out drifting per-file paths."

## Decisions

- The count applies only to bullets claiming an artifact is created or changed; both exemptions below are read from bullet wording alone, never from which section the bullet sits in (including `## Documentation updates`) — rules out threading section context through the checker, and rules out excluding doc bullets from either exemption for no fixture-backed reason.
- Exemption (a), stays-unchanged: the bullet carries a preservation verb (`stay`/`stays`, `remain`/`remains`, `unchanged`, `preserved`, `continue`/`continues`) and no build verb anywhere in the bullet — matches the #3680 fixture (Problem). Bare `green` and `stops` are excluded from the preservation list: they fire on ordinary prose about new work ("lands with the suite green", "a guard that stops the retry"), and "stays green" already matches on `stays`. A bullet mixing this wording with a genuine new-artifact build claim is still refused — rules out preservation wording laundering an unrelated build claim. Checking the build verb bullet-wide rather than "attached to a different artifact" rules out parsing which artifact a verb attaches to, at the cost of refusing a preserved-and-built bullet the author should have split anyway.
- Exemption (a)'s verb list deliberately diverges from `isBehavioralPreservationAc`'s (`shared/spec-parser.ts`) singular-only list (`stays`, `remains`) by adding the plural forms `stay`/`remain` — reusing that list verbatim misses "X and Y stay green" and would fail the exact #3680 fixture this exemption exists to fix.
- Exemption (b), one-decision-many-sites: the bullet states one outcome holds identically across the named artifacts (marker: `identical` or `the same`), rather than a distinct build claim per artifact — matches the #3700 fixture (Problem). It carries the same no-build-verb requirement as (a): the marker alone is ordinary incidental prose ("in the same directory", "the same shape"), so without it the exemption is fail-open and, checked first, silently defeats (a)'s mixed-claim refusal. The #3700 fixture's own verbs (`take`, `resolve`) are not build verbs, so the requirement does not cost the fixture. "One decision, one call site per bullet" is not the invariant here, "one outcome, uniformly true, building nothing" is.
- No path-count cap under either exemption — a cap would still trip incidents shaped like #3680/#3700 once the count of preserved tests or shared-outcome sites grows past it.
- Unmatched wording fails closed (counted toward the multi-artifact refusal) — a false refusal costs a reword, a false accept silently hides a fat bullet; that asymmetry rules out a fail-open default that swallows any wording the two vocab lists above don't cover.
- The refusal message names both paths and states the reading applied: the literal phrase `read as built or changed` for an ordinary multi-artifact refusal, or `mixes exempt wording with a build claim` when the bullet carried either exemption's wording alongside a build claim — rules out a message that leaves the author guessing which reading fired.
- Exemption detection is two pure predicates on bullet text (`isStaysUnchangedBullet`, `isSharedDecisionBullet`), module-local since nothing outside the checker reads them — rules out burying detection inside the thrower and forcing fixture-tree tests for every wording case.

## Task checklist

- [ ] Add `isStaysUnchangedBullet` and `isSharedDecisionBullet` to `shared/module-boundary-surfaces.ts` and route `assertSingleArtifactBullets` through them, with exemption (a)'s mixed-claim carve-out and the fail-closed default.
- [ ] Reword the refusal message to append the reading-applied phrase from the Decisions above.
- [ ] Add the fixture and refusal tests listed in Acceptance criteria.
- [ ] Reword the one-artifact authoring rule in `prompts/plan/draft.md` to match the enforced reading, and update its pinned snapshot in `shared/prompts/plan-draft.test.ts`.
- [ ] Update `v2/docs/spec-guidance.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] A test proves the #3680 fixture (quoted verbatim in Problem) as an Acceptance-criteria bullet passes the contract; it fails against the pre-fix unconditional path count.
- [x] A test proves the #3700 fixture (quoted verbatim in Problem) as a `## Decisions` bullet passes the contract; it fails against the pre-fix rule.
- [x] A test proves a bullet genuinely requiring two new artifacts (the existing two-root-file case in `shared/module-boundary-surfaces.test.ts`) is still refused, with a message naming both paths and containing the literal phrase `read as built or changed`; it fails against the pre-fix message, which lacks that phrase.
- [x] A test proves a bullet mixing exemption (a) wording with a distinct build claim on a second artifact (e.g. one file stays green, a second is newly created) is still refused, with a message containing the literal phrase `mixes exempt wording with a build claim`.
- [x] Tests prove both exemptions fail closed on a build claim: a shared-outcome marker does not launder one, does not defeat (a)'s mixed-claim refusal, and incidental "in the same directory" prose is not an exemption; bare `green`/`stops` prose about new work is refused. Each fails against a build-verb-free variant of the matching predicate.
- [x] `shared/module-boundary-surfaces.test.ts` stays green (existing multi-path fixtures there stay refused under either exemption).
- [x] `v2/src/execution/write.test.ts` stays green (`contract_miss` reason passthrough unchanged by this change).
- [x] `shared/prompts/plan-draft.test.ts` is updated to assert the reworded one-artifact rule text and passes; it fails against the pre-fix pinned snapshot.
- [x] `bun run typecheck` and `bun run test` pass (full suite: this change also touches root-tooling file `prompts/plan/draft.md`).

## Documentation updates

- `v2/docs/spec-guidance.md` — state what the one-artifact rule counts and what it exempts, with an example of each.
- `v2/docs/v1-behaviors.md` — record the changed plan-draft contract behavior.
- `prompts/plan/draft.md` — restate the authoring rule so drafts are written against the enforced reading.
