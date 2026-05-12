# 00 - Record `origin` URL on init

## Problem

Project records in `~/.jarvis/config.json` only store `root`. Future repo
resolution (subspec 01) needs to match a spec's declared git URL against
registered projects, which requires each project to know its own remote URL.

## Decisions

- Extend the `Project` schema with an optional `origin: string` field. Optional
  so existing configs remain valid without migration.
- `jarvis init` runs `git remote get-url origin` in the current repo and
  stores the trimmed result as `projects[<name>].origin`.
- If the repo has no `origin` remote, `jarvis init` still succeeds; `origin`
  is simply omitted. A one-line note is printed.
- On `jarvis run`, if the resolved project's `origin` is missing, jarvis
  attempts to populate it from the project's `root` and persists the update.
  Failures here do not block the run.
- No URL normalization is performed at write time. The string is stored
  verbatim as `git remote get-url` produced it. Normalization is a
  read-time concern (subspec 01).

## Task Checklist

- [ ] Add `origin?: string` to `Project` type and config validator.
- [ ] Update `jarvis init` to read and store `origin`.
- [ ] On run, lazily populate missing `origin` from the project's `root`.
- [ ] Update default config snapshot fixtures.
- [ ] Tests for: init records origin; init without origin remote succeeds;
  validator accepts both with and without origin; lazy population on run.

## Acceptance criteria

- [x] `Project` type and validator accept an optional `origin` string.
- [x] `jarvis init` in a repo with an `origin` remote stores
  `projects[<name>].origin` equal to the trimmed `git remote get-url origin`
  output.
- [x] `jarvis init` in a repo without an `origin` remote succeeds, prints a
  one-line note, and does not write `origin`.
- [x] On `jarvis run` for a project missing `origin`, jarvis populates it
  from the project's `root` when possible, persists the update, and
  continues; failure to populate does not abort the run.
- [x] Existing `~/.jarvis/config.json` files without `origin` continue to
  load without error.
- [x] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

- `docs/config.md`: extend the `Project` type definition and describe how
  `origin` is populated.
- `README.md`: mention that `jarvis init` records the origin URL.
