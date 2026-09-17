# Report every one-artifact offender in one refusal

`normalizePlanDraftSpecDir` currently throws on the first offending bullet; collect one-artifact offenders across the whole tree and refuse once.

## Decisions

- `assertSingleArtifactBullets` returns offenders instead of throwing; `normalizePlanDraftSpecDir` throws once after scanning all files — rules out per-file throwing, which still hides later files.
- Only one-artifact-bullet offenders are batched; missing-`## Acceptance criteria`-heading and index-link errors (`assertIndexLinks`) keep today's throw-on-first behavior — rules out folding a different failure class (tree shape, checked before bullet scanning starts) into the same refusal.
- Offenders are joined into one error message, one per line, each line reusing today's unchanged per-offender text — rules out a comma-joined single line, unreadable across files.
- Existing single-offender `toThrow` assertions in `shared/module-boundary-surfaces.test.ts` stay green unmodified: each still matches by substring against the now possibly longer message.

## Acceptance criteria

- [ ] A test proves a tree with several offending bullets across multiple files is refused once, naming all of them in a single error; it fails against the pre-fix check, which throws on only the first offender.
- [ ] Existing single-offender tests in `shared/module-boundary-surfaces.test.ts` (e.g. "rejects two artifact paths without module-boundary vocabulary") stay green unmodified.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes (full aggregate: this subspec also touches `prompts/plan/draft.md`, outside the v2/shared surfaces).

## Documentation updates

- `v2/docs/spec-guidance.md` — one-artifact rule: refusal collects and lists every offending bullet in the tree at once.
- `prompts/plan/draft.md` — the "One artifact per bullet" rule bullet: document all four mention exemptions (rules-out clauses, AC test-coverage pairs, doc-bullet leading paths, bare suffixes) and the collect-all-offenders refusal.
- `v2/docs/v1-behaviors.md` — update the plan-draft normalization entry for the one-artifact-bullet check: new mention exemptions and the all-offenders refusal replace the previous throw-on-first, two-exemption description.
