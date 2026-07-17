# 00 - Replace hardcoded /tmp fixtures with mkdtemp roots

## Problem

`v2/src/cli.test.ts` writes fixtures to hardcoded `/tmp/repo`, `/tmp/unregistered`, and
`/tmp/repo/v2/spec/...` (63 references). A coding agent's sandbox denies `/tmp` writes, so the
`beforeAll`/`beforeEach` hooks throw and the whole `test:v2` run fails before reaching any other
file — walling off every v2 implement run whose acceptance criteria require `bun run test:v2`. The
paths are also non-hermetic: concurrent runs share them and stale fixtures leak between runs.

## Decisions

- Each test/suite creates its fixture root with `mkdtempSync(join(tmpdir(), "jarvis-cli-test-"))`
  (or `$TMPDIR`), and every fixture path is derived from that root; rules out any hardcoded
  `/tmp/...` literal and makes the suite sandbox-safe and parallel-safe.
- Fixtures are cleaned up (`rmSync(root, { recursive: true, force: true })`) after the suite; rules
  out leaking temp dirs across runs.
- Registered project roots and spec paths in the fixtures reference the per-test temp root; rules out
  a residual absolute path that reintroduces the sandbox denial.
- No change to command behavior or to what the tests assert — fixture-location only; rules out
  altering coverage.

## Acceptance criteria

- [x] `v2/src/cli.test.ts` contains **no** hardcoded `/tmp/` path literal; all fixture roots come from
  `mkdtempSync` under the OS temp dir, and are removed after use.
- [x] The tests assert the same behavior as before (same describe/it structure and expectations);
  `bun test v2/src/cli.test.ts` passes.
- [x] `bun run check`, `bun run typecheck`, and `bun run test:v2` pass.

## Documentation updates

- None — internal test hygiene, no operator-facing surface.
