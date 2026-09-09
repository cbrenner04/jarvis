# 00 - Root docs are no-test-impact

## Problem

`NO_TEST_IMPACT_PATTERNS` lists `ready-intents/`, `reports/`, `v1/`, `v2/docs/`, `v2/spec/`; `ROOT_TOOLING_PATTERNS` lists `package.json`, `tsconfig*.json`, `.github/`, `scripts/`. A top-level `*.md` or `LICENSE` matches neither, falls to the unrecognized-path `return "full"`, and a root-doc + `v2/**` diff runs the whole suite — where any load-sensitive file can red-gate it.

## Decisions

- Top-level `*.md` files and `LICENSE` join `NO_TEST_IMPACT_PATTERNS` (`/^[^/]+\.md$/`, `/^LICENSE$/`); rules out blanket-whitelisting the repo root.
- `ROOT_TOOLING_PATTERNS` and the unrecognized-path `full` fallback are unchanged, so `Makefile` or a new root config still runs everything; rules out weakening the conservative default.
- The scope rule wherever it is stated (`AGENTS.md` working rule, runbook gate section) names root docs beside `v2/docs` and specs.

## Tasks

- Add the two patterns; extend `scripts/ci-test-scope.test.ts`.
- Update `AGENTS.md` and the runbook.

## Acceptance criteria

- [ ] `scripts/ci-test-scope.test.ts` test `root docs and LICENSE alone skip tests` proves `classifyChangedPaths(["README.md"])`, `(["AGENTS.md"])`, `(["CLAUDE.md"])`, and `(["LICENSE"])` each return `[]`; it fails against the current `full` fallback.
- [ ] `scripts/ci-test-scope.test.ts` test `a root doc beside v2 source scopes on v2` proves `classifyChangedPaths(["AGENTS.md", "v2/src/x.ts"])` returns `["test:v2", "test:integration:v2"]`.
- [ ] `scripts/ci-test-scope.test.ts` test `root tooling and unknown root paths still run the full suite` proves `["package.json"]` and `["Makefile"]` return `"full"`.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `AGENTS.md` — the test-scope rule lists root `*.md` and `LICENSE` with the no-test surfaces.
- `v2/docs/operator-runbook.md` — the ready/CI gate scope description, same clarification.
