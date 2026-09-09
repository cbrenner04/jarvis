# 01 - Enforce one artifact per bullet without a taxonomy

## Problem

`prompts/plan/draft.md:56` tells the plan agent that each acceptance-criteria bullet must reference exactly one file, and that a bullet spanning several surfaces "is rejected by the plan contract, which blocks the whole draft". That enforcement lives in `assertSingleSurfaceBullets`, which throws only when a bullet matches **two jarvis surface keywords** and does not already name exactly one artifact path.

Two problems follow. It is reachable only inside the split path retired by subspec 00, so removing the split would silently drop the rule the prompt advertises. And it decides using jarvis vocabulary, so in another project a bullet like "the flag is persisted" is rejected as multi-surface, while a genuinely two-file bullet whose wording happens to match no keyword passes.

The rule worth keeping is the one the prompt actually states — one artifact per bullet — and `referencedArtifactPaths` already computes that with no vocabulary at all.

## Decision ledger

- Enforce the bullet rule on referenced artifact **count**: a bullet under `## Acceptance criteria`, `## Decisions` or `## Documentation updates` that names more than one artifact path is rejected; rules out keyword classification, which both over- and under-matches relative to the stated rule.
- The rejection names the offending file, heading, bullet text, and every artifact path it found; rules out the current message, which reports a "multi-surface" cause that no longer exists and names no paths.
- A bullet naming zero artifact paths is accepted; rules out forcing prose bullets in `## Decisions` to name a file.
- The check runs on every draft, not only on drafts that would previously have been split; rules out enforcement that depends on the retired classifier having fired.

## Task checklist

- [ ] Replace `assertSingleSurfaceBullets` with an artifact-count check built on `referencedArtifactPaths`.
- [ ] Run it over the three bullet headings for every authored subspec in the draft.
- [ ] Update the error message to name the file, heading, bullet and the paths found.

## Acceptance criteria

- [x] `shared/module-boundary-surfaces.test.ts` proves an acceptance-criteria bullet naming two artifact paths is rejected with an error naming both paths and the owning file; it fails against the pre-fix multi-surface message.
- [x] `shared/module-boundary-surfaces.test.ts` proves a bullet naming exactly one artifact path is accepted regardless of wording, including one containing both "persisted" and "flag"; it fails against the pre-fix keyword rejection.
- [x] `shared/module-boundary-surfaces.test.ts` proves a prose bullet naming no artifact path is accepted.
- [x] `shared/module-boundary-surfaces.test.ts` proves the check rejects a two-path bullet in a draft that the pre-fix code would never have split, so enforcement no longer depends on the retired classifier.
- [x] `shared/module-boundary-surfaces.test.ts` proves an `index.md` linking an unknown subspec, and one linking a subspec twice, each still throw.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.

## Documentation updates

- `prompts/plan/draft.md` — restate the bullet rule as one artifact per bullet and drop the module-boundary-surface framing.
