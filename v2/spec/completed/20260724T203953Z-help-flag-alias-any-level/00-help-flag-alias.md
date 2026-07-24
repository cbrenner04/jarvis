# 00 - Help flag alias

## Problem

`jarvis --help` prints `unknown command: --help` and exits 1. No command accepts
`--help`/`-h`; operators must know the `jarvis help ...` form. Command parsers also reject
`jarvis run workflow --help` on missing required flags before help could render.

## Decisions

- Intercept `--help`/`-h` in `main()` (`v2/src/cli.ts`) before top-level dispatch, delegating to
  the same `renderHelp` path `help` uses. Rules out adding flag handling to each command parser,
  which would fail validation before reaching help.
- The alias fires only when the **first** `-`-prefixed argv token is `--help` or `-h`. Rules out
  "the flag may appear anywhere", which would hijack `run workflow intent --seed-text "… --help …"`
  into a help render. `jarvis --version --help` therefore stays a `--version` invocation and is not
  a new branch.
- Only the exact whole tokens `--help` and `-h` trigger the alias — no `--help=<value>`, no
  short-flag bundling (`-xh`).
- The candidate path is the leading run of non-`-` tokens; it resolves to the **longest prefix of
  that run that is a node in the command tree**. Rules out requiring an exact whole-run match, which
  would break positional-bearing invocations (`jarvis tui log abc123 --help` → `help tui log`) and
  dispatchable-but-untreed aliases (`jarvis run workflow intent-reviewed --help` → nearest ancestor).
- The unknown-segment error and exit 1 survive only when the *first* segment itself resolves to no
  node (`jarvis nope --help`). Rules out silently falling back to root help.

## Acceptance criteria

- [x] `jarvis --help` and `jarvis -h` print the same stdout as `jarvis help` and exit 0.
- [x] `jarvis run workflow --help` prints the same stdout as `jarvis help run workflow` and exits 0,
      without any missing-flag validation error.
- [x] `jarvis tui log abc123 --help` prints the same stdout as `jarvis help tui log` and exits 0
      (positional after a command).
- [x] `jarvis run workflow intent-reviewed --help` renders the nearest ancestor's help
      (`jarvis help run workflow`) and exits 0 rather than erroring (untreed alias).
- [x] `run workflow intent --seed-text "<prose containing --help>"` still runs the command; no help
      is rendered.
- [x] `jarvis --version` alone still prints the version and exits 0 after the intercept is inserted.
- [x] `jarvis nope --help` prints the unknown-segment error to stderr, nothing to stdout, exit 1.
- [x] A new test in `v2/src/cli.test.ts` walks the nodes of `commandTree` and asserts the
      `<path…> --help` and `<path…> -h` output equals the `help <path…>` output; it fails against
      the pre-fix code.
- [x] Inverting each guard this change adds fails at least one test: dropping the `--help`/`-h`
      token detection, dropping the first-`-`-prefixed-token restriction, and dropping the
      longest-resolvable-prefix truncation each turn a test red.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document the `--help`/`-h` alias in the top-level command help
  section: interception before dispatch, first-flag-token rule, longest-resolvable-prefix path rule,
  unknown-segment behavior. Note that alias output is byte-identical to `help`, including the root
  node's missing usage line (pre-existing `help` behavior, unchanged here).
- `v2/docs/v1-behaviors.md` — record the changed behavior: `--help`/`-h` no longer falls into the
  unknown-command exit-1 path.
