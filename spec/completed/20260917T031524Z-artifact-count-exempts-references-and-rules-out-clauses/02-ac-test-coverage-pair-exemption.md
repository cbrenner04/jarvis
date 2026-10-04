# Acceptance-criteria test-plus-production-path collapse

In an `## Acceptance criteria` bullet only, a test-file path plus the production path it exercises counts as one artifact.

## Decisions

- A path counts as a test file when its filename matches `<stem>.test.<ext>` (this repo's co-located test convention) — rules out matching by folder name (`test/`, `__tests__/`), which this repo doesn't use.
- A test path pairs with a production path only when they share a directory and the production filename equals the test filename with `.test` removed (e.g. state.ts / state.test.ts, same directory) — rules out pairing by bare filename alone, which would collapse unrelated same-named files from different directories.
- Pairing is scoped to `## Acceptance criteria` bullets; the same pair under `## Decisions` or `## Documentation updates` still counts as two artifacts — only an AC bullet claims a test covers a build.
- Every path not consumed by a pairing still counts individually, so a bullet naming two production paths and one matching test path still names two distinct artifacts.

## Acceptance criteria

- [x] A test proves an AC bullet naming `shared/state.ts` plus the shared/state.test.ts test that covers it passes — reversing the existing "rejects an acceptance criterion naming two artifact paths with actionable context" case in shared/module-boundary-surfaces.test.ts; it fails against the pre-fix check.
- [x] `shared/module-boundary-surfaces.test.ts`'s two-artifact-without-coverage rejections (e.g. "rejects two artifact paths without module-boundary vocabulary") stay green.
- [x] A test proves an AC bullet naming two production paths and one test path covering only one of them (three paths total) is still refused, since the unpaired production path remains a second distinct artifact.
- [x] A test proves the same production-path-plus-test-file pairing is still refused under `## Decisions` (the collapse is AC-only).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — one-artifact rule: an Acceptance-criteria bullet's test-plus-covered-production pair counts as one artifact.
