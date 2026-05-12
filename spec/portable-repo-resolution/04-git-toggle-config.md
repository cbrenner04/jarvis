# 04 - `git: true|false` config + per-project override

## Problem

Jarvis always creates a worktree, commits per subspec, pushes, and opens a
draft PR. Some target repos and workflows do not want any of that. The user
wants a single boolean to flip all of it off, configurable globally with an
optional per-project override.

## Decisions

- Add a top-level `git: boolean` field to the config schema. Default `true`
  to preserve current behavior.
- Add an optional `git?: boolean` field to each `Project` record. When set,
  it overrides the top-level value for that project.
- Effective value resolution: project-level override if defined; otherwise
  the top-level value; otherwise `true` (back-compat for configs predating
  this change).
- Validator rejects non-boolean values for either field with an error that
  names the offending file.
- `jarvis config` learns:
  - `jarvis config set-git <true|false>` — writes the top-level value.
  - `jarvis config set-project-git <name> <true|false|unset>` — writes or
    clears the per-project override; unknown project names exit 1.
- The actual loop-mode behavior changes (no worktree / no commits / no PR /
  completion rule / `--cwd`) live in subspec 05. This subspec only adds the
  config plumbing and surfaces the effective value to the run flow.

## Task Checklist

- [ ] Extend `Config` and `Project` types and validator.
- [ ] Bootstrap default config writes `git: true`.
- [ ] Implement `jarvis config set-git` and `set-project-git`.
- [ ] Surface the effective `git` value to `jarvis run` (consumed in
  subspec 05).
- [ ] Tests for: validator accepts/rejects values; effective resolution
  precedence; config subcommands round-trip; existing configs without `git`
  load and resolve to `true`.

## Acceptance criteria

- [ ] `Config` type validates a top-level `git: boolean` defaulting to
  `true`; non-boolean values fail validation with the file path in the
  error.
- [ ] `Project` type validates an optional `git?: boolean`; non-boolean
  values fail validation with the file path in the error.
- [ ] Effective `git` resolution returns the project override when set,
  else the top-level value, else `true`.
- [ ] `jarvis config set-git <true|false>` writes the value; invalid input
  exits 1.
- [ ] `jarvis config set-project-git <name> <true|false|unset>` writes,
  clears the override, or exits 1 for unknown names.
- [ ] Existing `~/.jarvis/config.json` files without a `git` field continue
  to load and resolve to `true`.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

- `docs/config.md`: add `git` to the schema, document the per-project
  override, list the new `jarvis config` subcommands.
- `README.md`: list the new subcommands in the commands section.
