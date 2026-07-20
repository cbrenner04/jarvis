# Add registry-backed command help

## Problem

The v2 CLI dispatches through repeated command branches and separately hard-codes the recognized names in its unknown-command diagnostic. It has no top-level `help` command, so command discovery can drift from dispatch.

## Decisions

- Register `help` as a normal top-level command; rules out a hidden help branch absent from its own listing.
- Use one queryable `{name, summary, usage}` registry for dispatch, help rendering, and unknown-command names; each entry owns its command handler, so no parallel handler-name mapping can drift.
- Keep no-argument and `--version` handling outside registry dispatch; rules out global CLI behavior changes.
- `jarvis help` accepts no operands or command-local options; `help foo` and `help --version` report the help entry's usage on stderr and exit non-zero.
- Print registry entries in registry order as `name<TAB>summary`, one line each, followed by one trailing newline; omit usage from the overview.

## Work

- Add registry metadata for `write`, `daemon`, `config`, `run`, `tui`, `cleanup`, and `help`, with non-whitespace one-line summaries and usage.
- Expose registry enumeration and exact-name lookup; route each recognized command through its registry entry without changing its handler or arguments.
- Render `jarvis help` from the registry and derive unknown-command recognized names from it; `usage` must match the existing authoritative command usage text, with `jarvis help` for the new entry.
- Add focused CLI regression coverage.
- Update the durable command behavior, v1/v2 parity docs, and the root v2 command catalog.

## Acceptance criteria

- [ ] `jarvis help` writes exactly `write`, `daemon`, `config`, `run`, `tui`, `cleanup`, and `help`, in registry order, as `name<TAB>summary` lines plus one trailing newline; each summary is non-whitespace and newline-free, stdout is otherwise empty, stderr is empty, and it exits `0`.
- [ ] A `v2/src/cli.test.ts` regression independently expects the complete `write`, `daemon`, `config`, `run`, `tui`, `cleanup`, and `help` overview and fails against the baseline before passing after implementation.
- [ ] `v2/src/cli.test.ts` covers `help foo` and `help --version` reporting `jarvis help` usage on stderr and exiting non-zero.
- [ ] Registry enumeration and exact-name lookup expose exactly one entry for every dispatched command; every `name`, `summary`, and `usage` is non-whitespace, summaries contain no newline, each entry owns its handler, and each usage matches its existing authoritative command usage text (or `jarvis help` for help).
- [ ] `v2/src/cli.test.ts` proves dispatch, help rendering, and unknown-command recognized names are derived from registry entries, without an independent handler-name mapping.
- [ ] Unknown-command regressions in `v2/src/cli.test.ts` expect `help` in the recognized names while preserving stderr output and a non-zero exit; `constructor` and `toString` remain unknown commands.
- [ ] Existing dispatch coverage in `v2/src/cli.test.ts` and `v2/src/commands/*.test.ts` stays green.
- [ ] No-argument and `--version` coverage in `v2/src/cli.test.ts` stays green.
- [ ] `README.md` keeps its exhaustive v2 command catalog synchronized with `help`; `v2/docs/write-behavior.md` documents `jarvis help` and the top-level registry source of truth; `v2/docs/v1-behaviors.md` records the v2 help and registry-backed dispatch behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document `jarvis help` and the top-level registry source of truth.
- `v2/docs/v1-behaviors.md` — record the v2 help surface and registry-backed dispatch while preserving existing command behavior.
- `README.md` — add `jarvis help` to the exhaustive v2 command catalog.
