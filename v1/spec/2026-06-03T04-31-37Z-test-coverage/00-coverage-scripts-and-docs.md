# 00 - Coverage scripts and docs

## Decisions

- Four parallel scripts mirroring `test:*`, not one script with env flags:
  - `coverage` — `bun test --coverage`
  - `coverage:v1` — `bun test --coverage ./v1/`
  - `coverage:v2` — `bun test --coverage ./v2/`
  - `coverage:shared` — `bun test --coverage ./shared/ ./scripts/ ./test/`
- `coverage:shared` includes root `./test/`; rules out treating root tests as v1-owned.
- Stdout-only via Bun's default text reporter; no `coverage/` artifacts. Rules out lcov/html wiring.
- Wiring lock test asserts the four script command strings exactly. Rules out shell-grepping `package.json`.

Deferred to first consumer: report persistence/format — pin when a reviewer, dashboard, or CI gate needs durable artifacts.
Deferred to first consumer: per-slice thresholds — pin when the first no-drop guard lands.

## Task checklist

- Add the four scripts to `package.json`.
- Create `v1/docs/test-coverage.md`.
- Link the doc from `README.md`.
- Add `test/coverage-scripts.test.ts`.

## Acceptance criteria

- [ ] `package.json` exposes `coverage`, `coverage:v1`, `coverage:v2`, `coverage:shared` with the exact commands in Decisions.
- [ ] `bun run coverage:v1` exits 0 and prints a coverage table including a `v1/src/` file.
- [ ] `bun run coverage:v2` exits 0 and prints a coverage table including a `v2/` source file.
- [ ] `bun run coverage:shared` exits 0 and prints a coverage table including a `shared/` or `scripts/` file.
- [ ] `bun run coverage` exits 0 and prints an aggregate coverage table.
- [ ] `v1/docs/test-coverage.md` documents each script, its slice, how to read Bun's output, stdout-only reports, and that thresholds / `ready` integration / no-drop guards are current non-goals.
- [ ] `README.md` links to `v1/docs/test-coverage.md`.
- [ ] `test/coverage-scripts.test.ts` passes and fails if any of the four script command strings drifts.

## Documentation updates

- Create `v1/docs/test-coverage.md`.
- Update `README.md` to link it.
