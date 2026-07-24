# Remaining command flags and parser parity

## Problem

`write`, `cleanup`, `run list`, and `daemon log` still omit structured flags from help. Nothing guards against a parser accepting a flag that help never lists.

## Decisions

- Parser parity is enforced per help node path (`write`, `run start`, `cleanup`, `run list`, `daemon log`, plus workflow presets after `00`); rules out only spot-checking workflow presets from `00`.
- Parity compares each node's `flags` metadata to the same option set its parser consumes (including accepted short aliases)—one authoritative definition per command path shared by parser and guard; rules out a third hand-maintained expected-flag list in tests or scanning `usage.ts` prose as the source of truth.
- `help-flags-parity.test.ts` is the long-term authority for which flags each node must list (including workflow presets); `00` CLI regressions stay focused smoke.
- `run start` shares the write parser surface and must expose the same flag list as `help write`; rules out divergent flag metadata between those two nodes.
- Deferred to first consumer: whether `usage:` lines are shortened once structured flags ship — pin when an implementer changes error-path usage rendering; until then `usage:` prose may still mention flags and need not be deduplicated immediately.

## Work

- Register flags for `write`, `run start`, `cleanup`, `run list`, and `daemon log` on their command-tree nodes.
- Add an automated guard that fails when any parser-accepted flag for those nodes (and the workflow presets from `00`) is missing from the matching node's help flag list.
- Update tests that assert exact `jarvis help …` stdout (`cli.test.ts`, `renderHelpNode` coverage, and siblings) so new flag lines are expected.
- Document the flag section in `v2/docs/write-behavior.md` (line format, canonical long names, `argumentShape` for booleans vs value flags, declaration order, short-alias presentation) and that `usage:` prose may still mention flags until error-path usage is shortened; record the expanded help surface in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `jarvis help write`, `jarvis help cleanup`, `jarvis help run list`, and `jarvis help daemon log` list every parser-accepted flag with a non-empty description; `jarvis help run start` matches `jarvis help write` flag lines.
- [x] `v2/src/cli/help-flags-parity.test.ts` fails when a parser-accepted flag is dropped from its node's registered flags and passes with the full registration.
- [x] Inverting the parity guard (e.g. excluding one expected flag from the assertion set while it remains parser-accepted) fails the parity test.
- [x] Exact-help stdout tests for affected nodes are updated for new flag lines and pass with full registration.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — CLI help flag lines (format, long names, `argumentShape`, ordering, short aliases); `usage:` prose may duplicate flags until error-path shortening.
- `v2/docs/v1-behaviors.md` — v2 help lists per-node flags.
