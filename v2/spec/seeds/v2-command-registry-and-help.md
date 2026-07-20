# Seed: a v2 command registry powers `jarvis help` and did-you-mean

## Problem

v2 `cli.ts` dispatches via a hardcoded `if (command === "...")` chain; usage strings are
unstructured per-command constants in `v2/src/cli/usage.ts`. There is no `jarvis help` command
and no queryable registry of `{name, summary, usage}`. Two deferred features both need one:
`jarvis help` (command overview) and the unknown-command "did you mean `<x>`?" close-match.
[[v2-unknown-command-error]] ships the bare unknown-command error + non-zero exit without either,
listing recognized commands inline from the dispatch set.

## Decisions

- Introduce one registry of v2 commands (`{name, summary, usage}`) that dispatch, `jarvis help`,
  and unknown-command handling all read — no duplicated command lists.
- `jarvis help` prints an overview (each command + one-line summary) sourced from the registry;
  exits 0.
- Unknown-command handling appends "did you mean `<x>`?" when exactly one registered name is a
  close match, and points at `jarvis help`.

## Acceptance criteria

- [ ] `jarvis help` lists every v2 command with a one-line summary, sourced from the registry.
- [ ] Dispatch resolves commands via the registry with no behavior change to existing commands.
- [ ] An unknown command close to exactly one registered name appends "did you mean `<x>`?" and
      points at `jarvis help`; exit stays non-zero.
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document `jarvis help` and the command registry as the CLI surface source of truth.
