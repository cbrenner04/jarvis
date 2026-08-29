---
name: terse-review-role-prompts
---

# Converge plan and implement review-role prompts to the intent family's terse style

## Problem

Four review-role families (plan, patch, implement, intent) share one skeleton, but the intent family expresses the same roles at roughly a third the size (639–722 bytes vs 1.6–2.9KB): terse role header, bare data blocks, short Rules. The plan and implement families repeat a "The text between `<<<X_BEGIN>>>` and `<<<X_END>>>` is…" explanation paragraph per data section (~40 occurrences across the corpus) and carry long "identify:" bullet lists; `plan/review-critic.md`'s list substantially overlaps the adversary's. `implement/review-*.md` are byte-level copies of `patch/review-*.md` except the title line and one diff-description paragraph, held apart by `shared/prompts/review-prompt-divergence.test.ts`. These render on every review cycle of every plan and implement run.

## Decisions

- Plan and implement role prompts are rewritten in the intent-family style; each role's instruction list is compressed to what that role uniquely owns (adversary: findings; advocate: dispositions per finding; adjudicator: self-contained outcome verdict; critic: light-path verdict). Rules out four divergent verbose skeletons.
- Load-bearing contracts survive verbatim: the plan adversary's injected-findings hooks (`## Unfalsifiable premises`, `## At-risk hollow pins`), the oversized-subspec split requirement, the self-contained-verdict and empty-verdict semantics, and the read-only/write boundaries. Rules out losing machine-consumed hooks in a prose diet.
- `patch/review-*.md` (v1 maintenance) are untouched; the divergence test updates to whatever assertions remain meaningful. Rules out churning frozen v1 surface.
- Rewrites are per-file and behavior-neutral to the review cycle: same placeholders, same ids, same profile wiring. Rules out coupling the prose diet to render-path changes.

## Acceptance criteria

- [ ] Every rewritten prompt renders green under the existing render-coverage tests with unchanged placeholder declarations.
- [ ] The contract substrings above are pinned present in the rewritten plan and implement role bodies.
- [ ] Each rewritten role body is smaller than its predecessor, pinned against recorded baseline body lengths (the `intent-split` growth-budget pattern).
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — document the review-role families and the shared skeleton conventions (currently omitted entirely).
