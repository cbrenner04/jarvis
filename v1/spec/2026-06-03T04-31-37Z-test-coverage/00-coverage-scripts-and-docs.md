# 00 - Coverage scripts and docs

Add `bun test --coverage` wiring for the v1, v2, and shared/root slices, document how to run it, and lock the wiring with a test.

## Decisions

- Coverage uses `bun test --coverage`; no third-party runner. Rules out adding c8/istanbul.
- One script per slice plus an aggregate, mirroring `test:*`:
  - `coverage` — aggregate (`bun test --coverage`)
  - `coverage:v1` — `bun test --coverage ./v1/`
  - `coverage:v2` — `bun test --coverage ./v2/`
  - `coverage:shared` — `bun test --coverage ./shared/ ./scripts/ ./test/`
  Rules out collapsing into a single script with env flags.
- `coverage:shared` test roots are `./shared/`, `./scripts/`, and `./test/` (root-owned tests/fixtures). Rules out treating root-level `test/` as v1-owned.
- Coverage runs are stdout-only via Bun's default text reporter; no report files written to disk. Rules out wiring an lcov/html reporter or a `coverage/` output dir.
- Docs home: new `v1/docs/test-coverage.md`, linked from `README.md`. Rules out scattering across `v1/docs` + `v2/docs`.
- Measurement-only: no `coverageThreshold` in `bunfig.toml`, no `ready` integration, no CI gate. Documented as a current non-goal.
- Wiring test lives alongside `test/test-slices.test.ts` as `test/coverage-scripts.test.ts` and asserts the four `coverage*` scripts have exact expected command strings. Rules out grepping package.json from a shell script.

Deferred to first consumer: coverage report persistence and format — pin when a reviewer, dashboard, or CI gate needs durable artifacts.
Deferred to first consumer: per-slice coverage thresholds — pin when the first no-drop guard lands.

## Task checklist

- Add `coverage`, `coverage:v1`, `coverage:v2`, `coverage:shared` scripts to `package.json`.
- Create `v1/docs/test-coverage.md` documenting commands, slice boundaries, output interpretation, and the measurement-only stance.
- Link the new doc from `README.md` (test section or equivalent).
- Add `test/coverage-scripts.test.ts` asserting the four script command strings exactly.

## Acceptance criteria

- [ ] `package.json` exposes `coverage`, `coverage:v1`, `coverage:v2`, `coverage:shared` scripts with the exact commands listed in Decisions.
- [ ] `bun run coverage:v1` exits 0 and prints a Bun coverage table including at least one `v1/src/` file.
- [ ] `bun run coverage:v2` exits 0 and prints a Bun coverage table including at least one `v2/` source file.
- [ ] `bun run coverage:shared` exits 0 and prints a Bun coverage table including at least one `shared/` or `scripts/` file.
- [ ] `bun run coverage` exits 0 and prints a single aggregate Bun coverage table.
- [ ] `v1/docs/test-coverage.md` exists and documents: each script, what slice each covers, how to read Bun's coverage output, that reports are stdout-only, and that thresholds / `ready` integration / no-drop guards are explicit current non-goals.
- [ ] `README.md` links to `v1/docs/test-coverage.md`.
- [ ] `test/coverage-scripts.test.ts` exists, passes under `bun test`, and fails if any of the four `coverage*` script command strings drifts from the documented form.

## Documentation updates

- Create `v1/docs/test-coverage.md` (operator/workflow doc, per `v2/docs/documentation-standard.md` placement policy: workflow behavior — `v1/` workflow doc home is `v1/docs/`).
- Update `README.md` to link the new doc.
