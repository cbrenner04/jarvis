# Implement review optional sections

`patchBodyPrompt` in `shared/prompts/review-implement.ts` omits empty repo-guidance, active-subspec, and timeout-checkpoint blocks via local `stripOptionalSection`, then patches newline spacing with `.replace` on the assembled string.

## Decisions

- Declare `optionalSections` on `patch.prompt.body` for `REPO_GUIDANCE`, `ACTIVE_SUBSPEC_PATH`, and `TIMEOUT_CHECKPOINT_CONTEXT`; resolve through `renderArtifactTemplate` — rules out local `stripOptionalSection` in `review-implement.ts`.
- Bind optional-section omission to `renderArtifactTemplate` trim-based emptiness (`undefined`, `null`, `""`, or whitespace-only string per `v2/docs/prompts.md`) for `REPO_GUIDANCE`, `ACTIVE_SUBSPEC_PATH`, and `TIMEOUT_CHECKPOINT_CONTEXT` — rules out v1 `content.length === 0` strict emptiness and call-site bridging shims.
- Eliminate the trailing `.replace("\n\nFollow these Jarvis rules:", …)` by fixing spacing in `prompts/patch/instructions.md` and relying on optional-section excision trailing-newline consumption — rules out retaining post-render newline surgery as a shim.
- Delete `stripOptionalSection` from `review-implement.ts` once migrated — rules out leaving a shared copy for implement-only excision.

## Tasks

- Add `optionalSections` JSON frontmatter to `prompts/patch/instructions.md`; bump `revision`; adjust body spacing so an all-empty optional path yields a single newline before `Follow these Jarvis rules:`.
- Route `patchBodyPrompt` through `renderArtifactTemplate`; remove `stripOptionalSection` and assembled-string `.replace`.
- Add optional-section omission regression coverage to `shared/prompts/review-implement.test.ts`, including whitespace-only `REPO_GUIDANCE`.

## Acceptance criteria

- [ ] `shared/prompts/review-implement.test.ts` — optional-section omission regression test fails against pre-fix `stripOptionalSection` in `review-implement.ts` and passes after declared `optionalSections` migration.
- [ ] `shared/prompts/review-implement.test.ts` — whitespace-only `REPO_GUIDANCE` omits `## Repo Guidance`; fails against pre-fix `stripOptionalSection` (length-only check) and passes after `renderArtifactTemplate` migration.

## Documentation updates

- None. `v2/docs/prompts.md` already documents optional-section render semantics.
