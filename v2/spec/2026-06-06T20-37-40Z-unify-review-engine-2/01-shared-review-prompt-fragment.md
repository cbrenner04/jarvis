# Shared review-prompt fragment

`prompts/plan/review.md` and `prompts/patch/review.md` duplicate the review framing: the subtractive-bias intro ("cut over add", "do not expand scope"), the no-commit / no-push / no-tests rules, and the subtractive instructions. Factor that shared wording into one fragment both step prompts include, leaving only the mode-specific boundary and blocker lines in each step file.

`prompts/shared/pr-description.md` (id `shared.pr-description`, `behavior: shared-pr-description`, `kind: fragment`, `add:`-ed by both `plan/pr-description.md` and `patch/pr-description.md`) is the exact precedent.

## Decisions

- New fragment `prompts/shared/review.md` carries the cross-mode wording; both review steps pull it via `add: [shared.review]`. Rules out a `global`-behavior fragment, which would prepend to *every* prompt, not just the two review steps.
- Keep mode-specific lines in each step file: plan's "rewrite spec files in place / intent.md immutable except blocker / don't delete index.md / `## Acceptance criteria` per subspec"; patch's "code read-only spec / `.jarvis-review-blocker` sentinel / follow branch conventions". Rules out hoisting boundary/blocker wording into the shared fragment, where the two modes genuinely differ.
- Register the fragment in `prompts/registry.txt`. Bump each touched artifact's `revision`.
- Net rendered prompt for each mode must still contain the shared lines (assembled via the fragment) — this is pure relocation, not a wording change.

## Task checklist

- Add `prompts/shared/review.md` with the shared wording and fragment frontmatter mirroring `shared/pr-description.md`.
- Add it to `prompts/registry.txt`.
- Add `add: [shared.review]` to `prompts/plan/review.md` and `prompts/patch/review.md`; remove the now-duplicated lines from each; bump revisions.
- Update/extend any prompt-assembly snapshot or golden tests.

## Acceptance criteria

- [ ] `prompts/shared/review.md` exists with `kind: fragment` and a non-`global` behavior, registered in `prompts/registry.txt`.
- [ ] Both `prompts/plan/review.md` and `prompts/patch/review.md` declare `add: [shared.review]` and no longer carry the shared wording inline.
- [ ] The assembled `plan.prompt.review` and `patch.prompt.review` each still contain the shared review wording (verified by a test rendering both).
- [ ] All placeholders required by each step still validate against the registry (no missing/extra placeholder errors).
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/prompts.md`: list `shared/review.md` alongside `shared/pr-description.md` as a cross-mode shared fragment, including which steps `add:` it.
- `v1/docs/prompt-governance.md`: if it enumerates review-prompt content, note the shared fragment split.
