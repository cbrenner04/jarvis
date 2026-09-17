# 00 — Intent-landing lint seam

`validateIntentStage` → `repairIntentStageContent` → `runMarkdownlintAutofix` (`shared/intent-stage.ts`) spawns real `bun markdownlint-cli2` on every landing; `v2/src/execution/intent-output.test.ts` pays ~1.45s per test.

## Decisions

- Thread the existing `AsyncSubprocessRunner` (`runner?` on `runMarkdownlintAutofix`) through `validateIntentStage` and `v2/src/execution/intent-output.ts` input as an optional dependency; production default stays `realAsyncSubprocessRunner` — rules out a module-level mock or env toggle.
- Seam name carries no `ForTest` suffix (production-code rule).
- Unit tests inject a no-op runner; one real-binary landing test moves to an integration-slice file (a `*.sandbox-unrunnable.test.ts` file, which the test runner routes to the integration slice) — rules out deleting real coverage.

## Tasks

- [ ] Add optional runner dependency to `shared/intent-stage.ts` landing path.
- [ ] Accept and forward it in `v2/src/execution/intent-output.ts`.
- [ ] Stub it in `v2/src/execution/intent-output.test.ts`; add one real-binary integration test.

## Acceptance criteria

- [x] A unit test asserts an injected runner receives the markdownlint invocation for a landed intent; it fails against the pre-change code (no seam).
- [x] One real-binary integration test covers the intent-landing path and runs under `bun run test:integration:v2`.
- [x] `v2/src/execution/intent-output.test.ts` per-test time is below 0.5s.
- [x] `shared/markdownlint-repair.test.ts` stays green.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, `bun run test:integration:shared`, and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — lint stub seam for intent landing; before/after per-test time for the intent-output tests.
