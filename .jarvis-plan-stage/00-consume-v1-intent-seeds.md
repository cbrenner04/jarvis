# Consume v1 Intent Seeds

## Scope

Consume file seeds when v1 intent fan-out succeeds; retain inline and failed inputs.

## Decisions

- Consume seeds at promotion success, not cleanup/archive; rules out stale `seeds/` backlogs.
- Put git-backed deletion in the intent artifact commit, not the operator checkout; rules out an uncommitted queue mutation outside the publication branch.
- Validate source and mapped worktree targets with real-path containment before deletion; rules out lexical-only checks, missing targets, external inputs, and symlink escapes.
- Delete non-git seeds only after every emitted intent lands; rules out partial fan-out stranding a consumed seed.
- Carry all file inputs actually read as a collection; rules out first-input-only cleanup in batched promotion.
- Leave inline seeds artifact-free; rules out synthesizing a deletion target.
- Preserve external-spec archival cleanup; rules out changing post-implementation retirement semantics.

## Work

- Add a shared safe input-consumption boundary and wire it to committed and no-commit v1 intent publication.
- Cover fan-out, all recorded inputs, publication failures, and unsafe targets.
- Align `v1/docs/spec-guidance.md`, `v1/docs/intent-mode.md`, and the v1 parity record in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] Successful v1 file-seed intent promotion consumes every seed read after all authored intents are durable; inline promotion creates no source deletion.
- [ ] Git-backed deletion lands in the intent artifact commit, while failed publication leaves the source queue intact and retryable.
- [ ] Non-git failure or partial fan-out leaves every seed intact.
- [ ] Missing, external, or symlink-escaped mapped targets are skipped after source-side and worktree-side real-path checks.
- [ ] `shared/promotion-input-consumption.test.ts` and `v1/test/intent-command.test.ts` add pre-fix-failing coverage for committed and no-commit success, failure, fan-out/all-recorded-input consumption, inline input, and unsafe targets.
- [ ] `v1/docs/spec-guidance.md`, `v1/docs/intent-mode.md`, and `v2/docs/v1-behaviors.md` document file seeds as open work and the shipped success boundary.
- [ ] Existing external-spec cleanup behavior remains covered and unchanged.
