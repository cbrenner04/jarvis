# `config set-agents` writes any string to the agent order, including flags

## Problem

`jarvis config set-agents` performs no validation. Asking it for help **corrupts the config**:

```console
$ jarvis config set-agents --help
{"agents":["--help"]}
```

The agent order is now a single nonexistent agent named `--help`, persisted to
`~/.jarvis/config.json`. Every subsequent run resolves no usable binding. Observed 2026-07-21;
recovered only because the next command happened to overwrite the whole list.

Two contributing gaps:

- No membership check against the known adapters (`claude`, `codex`, `cursor`, …), so typos
  (`cursour`, `claud`) persist silently and surface later as a run failure rather than a CLI error.
- The argument separator is undocumented and inconsistent with the usage line. Space-separated
  (`set-agents cursor claude codex`) prints the generic `usage:` string and changes nothing;
  comma-separated (`set-agents cursor,claude,codex`) works. The usage line
  (`usage: jarvis config <show|path|set-agents> [args]`) says neither.

## Decisions

- Validate every name against the known adapter set before writing; reject the whole invocation
  with a named error listing the unknown entries and the valid ones. Rules out partial writes.
- Treat a leading-dash argument as a flag, not an agent name; `--help` prints usage and exits
  without touching config.
- Document and accept the separator explicitly in the usage string; keep the currently working
  comma form and either accept spaces too or reject them with a message that names the right form.
- Reject an empty list and duplicate entries — a duplicated agent in one order is already a known
  operator hazard.
- Rules out validating at run time only; the write is where the operator can still fix it cheaply.

## Acceptance criteria

- [ ] `jarvis config set-agents --help` prints usage, exits non-zero-or-zero per convention, and
      leaves `~/.jarvis/config.json` unchanged.
- [ ] An unknown agent name is rejected with an error naming the unknown entries and the valid set;
      the stored order is unchanged.
- [ ] An empty list and a list with duplicates are both rejected without writing.
- [ ] A valid list is written and `jarvis config show` reflects it.
- [ ] The usage string states the accepted separator, and the accepted form(s) work as documented.

## Documentation updates

- `v2/docs/install-and-config.md` — `set-agents` argument form and validation.
