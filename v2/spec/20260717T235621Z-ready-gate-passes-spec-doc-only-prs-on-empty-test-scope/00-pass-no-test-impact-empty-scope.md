# 00 - Pass no-test-impact empty scope through ready

## Problem

`jarvis1 triage <target> --merge` scopes the local ready gate via
`resolveReadyTestScope` → `classifyChangedPaths` (`scripts/ci-test-scope.ts`).
A diff of only `v1/docs/**`, `v1/spec/**`, `v2/docs/**`, `v2/spec/**`, and/or
`reports/**` correctly resolves to `[]` and sets `JARVIS_READY_TEST_SCOPE=""`.
`scripts/ready.ts` then exits `1` with
`ready: resolved test scope contains no test steps` before `check`, `typecheck`,
or `lint:md` run — blocking the gated merge path for plan, intent, seed, report,
and doc-only PRs that legitimately touch no test-bearing code.

Observed 2026-07-17 on plan PR #1691 after #1684 made triage reach the gate.

## Decisions

- Remove the hard `process.exit(1)` on explicit empty `testScope` in `runReady`; rules out a parallel skip flag — `getReadyCommands` already omits test steps when scope is `[]`.
- Empty-scope pass-through applies only to harness-produced `JARVIS_READY_TEST_SCOPE=""` from `classifyChangedPaths` returning `[]` (all changed paths match `NO_TEST_IMPACT_PATTERNS`); rules out weakening classification for code-bearing paths — those still resolve non-empty scopes.
- `full`-tier gate still runs `check`, `typecheck`, and `lint:md` when test scope is empty; rules out bypassing verification for doc/spec-only PRs.
- Do not duplicate `NO_TEST_IMPACT_PATTERNS` in `ready.ts`; rules out a second divergent docs-only classifier.

## Acceptance criteria

- [ ] `runReady` exits `0` when `JARVIS_READY_TEST_SCOPE=""`, runs no `bun run test*` step, and still runs the remaining `full`-tier steps (`check`, `typecheck`, `lint:md`).
- [ ] `runReady` with `JARVIS_READY_TEST_SCOPE="test:v1 test:integration:v1"` still runs those test steps and exits non-zero when a test step fails (scoped implementation-PR guard unchanged).
- [ ] A regression test in `v1/test/ready-script.sandbox-unrunnable.test.ts` drives `runReady` with `JARVIS_READY_TEST_SCOPE=""` and asserts exit `0` with no test argv; it fails against the pre-fix `process.exit(1)` path.
- [ ] `v1/test/ready-gate.test.ts` `resolveReadyTestScope` cases and `getReadyCommands runs no test step when the resolved test scope is empty` stay green.
- [ ] `v1/docs/operator-runbook.md` § The gate states that an empty resolved test scope passes (skips test steps) when the diff is no-test-impact only, and that `triage --merge` works for spec/doc-only plan PRs without a hand `--admin` fallback for empty scope.
- [ ] `v2/docs/v1-behaviors.md` records the updated empty-scope ready-gate behavior.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate — empty-scope pass for no-test-impact diffs; confirm `triage --merge` for spec/doc-only plan PRs.
- `v2/docs/v1-behaviors.md` — ready-gate empty-scope behavior (existing `bun run ready` bullet).
