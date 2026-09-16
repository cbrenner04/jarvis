# Intent scratch under project spec home

Intent scratch moves from `<jarvisRoot>/intent-work/<safeId>/<slug>` to `<specsHome(projectKey)>/intent-work/<slug>`. Other external-home layout (`seeds/`, `ready-intents/`, `plans/<name>/`, `plans/completed/`) is unchanged.

## Decisions

- `paths.ts` exports `intentWorkRoot(projectKey, jarvisRoot?)` built on `specsHome`; call sites already threading an injected root consume it instead of joining `"intent-work"` inline.
- No migration of existing `<jarvisRoot>/intent-work` dirs; rules out a move step, since scratch is transient.

## Acceptance criteria

- [x] A test pins intent scratch resolving under `<jarvisRoot>/specs/<safeId>/intent-work/<slug>`; it fails against the pre-fix code.
- [x] `v2/src/daemon/pipeline-stage-resolve.test.ts` intent-work fixtures use the new location and pass.
- [x] The structural `"specs"` guard from subspec 00 stays green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — external-home tree shows `intent-work` under the project home.
- `v2/docs/v1-behaviors.md` — record the intent scratch location.
