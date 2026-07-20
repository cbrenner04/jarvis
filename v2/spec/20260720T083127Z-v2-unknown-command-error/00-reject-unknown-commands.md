# Reject unknown commands

Unknown top-level v2 commands currently print `v2 not ready` to stdout and report success, hiding operator typos.

## Decisions

- Keep bare `jarvis` behavior unchanged; rules out treating a missing command as an unknown token.
- List `write`, `daemon`, `config`, `run`, `tui`, and `cleanup` directly at the dispatch boundary; rules out introducing the deferred command registry.
- Do not advertise help or suggest close matches; rules out pointing operators at nonexistent or deferred surfaces.

## Implementation

- Replace the unknown-command success fallthrough with a targeted stderr diagnostic and non-zero result.
- Update top-level CLI dispatch tests for the error path and preserved no-argument path.
- Record the v2 command/error semantics in the parity catalog.

## Acceptance criteria

- [x] An unknown top-level command writes nothing to stdout, writes stderr that names the supplied command and lists `write`, `daemon`, `config`, `run`, `tui`, and `cleanup`, and exits non-zero.
- [x] The unknown-command regression in `v2/src/cli.test.ts` fails against the pre-fix code and passes after the change.
- [x] The no-argument dispatch test in `v2/src/cli.test.ts` stays green.
- [x] `v2/docs/v1-behaviors.md` records the v2 unknown-command diagnostic, stream, recognized-command list, and exit semantics.

## Documentation updates

- Update `v2/docs/v1-behaviors.md`; this changes existing operator-facing CLI behavior.
