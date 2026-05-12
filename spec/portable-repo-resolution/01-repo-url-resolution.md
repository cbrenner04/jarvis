# 01 - Spec `repo:` URL parsing and resolution flow

## Problem

Today `jarvis run` requires `repo: <absolute-local-path>` in the spec body
and uses that path verbatim. We need a portable form (URL or slug) and a
resolution flow that does not require the spec to know any local filesystem
detail.

This subspec covers the parser, the URL normalizer, the resolution order
(except the interactive prompt, which is subspec 02, and the legacy
absolute-path branch, which is subspec 03).

## Decisions

- `repo:` becomes optional in the spec.
- When present, accepted forms are:
  - HTTPS URL: `https://github.com/owner/repo[.git]`
  - SSH URL: `git@github.com:owner/repo[.git]`
  - Slug: `owner/repo` (interpreted as `github.com/owner/repo` for matching)
- Add a `--repo <name|path|url>` flag to `jarvis run`. Accepts a registered
  project name, an absolute path that equals a registered project's `root`,
  or a URL/slug that matches a registered project's `origin` after loose
  normalization.
- Loose URL normalization: strip leading protocol (`https://`, `http://`,
  `ssh://`), strip leading user (`git@`), strip trailing `.git`, replace
  `:` after host with `/` (SSH form), lowercase host and owner/repo
  components. Compare normalized strings.
- Resolution order on `jarvis run`:
  1. `--repo` flag (if given) → resolve and stop. Errors on no match.
  2. Spec `repo:` URL or slug → loose-match against registered projects.
     Single match wins. No matches falls through to step 3. Multiple matches
     trigger the prompt (subspec 02).
  3. Spec path is inside a registered project's `root` (path prefix check)
     → use that project.
  4. Spec path is inside any git checkout (walk parents until a `.git`
     entry is found, stopping at filesystem root) → use that checkout, even
     if it is not a registered project. The run then proceeds in
     ad-hoc mode: jarvis behaves as if the project were registered for the
     duration of the run but does not persist anything to config.
  5. Fall through to subspec 02 (prompt).
- Legacy absolute-path `repo:` is handled in subspec 03 and short-circuits
  this flow when it matches a registered `root`.

## Task Checklist

- [ ] Implement URL normalization helper with unit tests.
- [ ] Extend the spec parser to accept optional `repo:` of URL/slug form.
- [ ] Implement the resolution function returning `{ project, root, mode:
  "registered" | "ad-hoc" }`.
- [ ] Add `--repo` flag to `jarvis run`.
- [ ] Tests for each resolution branch.

## Acceptance criteria

- [ ] URL normalization treats these as equal:
  `git@github.com:Org/Repo.git`, `https://github.com/org/repo`,
  `https://github.com/org/repo.git`, `ssh://git@github.com/org/repo.git`.
- [ ] A spec with `repo: org/repo` and a single registered project whose
  `origin` normalizes to `github.com/org/repo` resolves to that project
  without prompting.
- [ ] A spec with no `repo:` line, located inside a registered project's
  `root`, resolves to that project.
- [ ] A spec with no `repo:` line, located inside a non-registered git
  checkout, resolves to that checkout in ad-hoc mode without writing config.
- [ ] `jarvis run --repo <name>` overrides the spec and the location-based
  rules.
- [ ] `jarvis run --repo <url>` resolves via loose URL match against
  registered `origin` values.
- [ ] An unknown `--repo` value exits 1 with a message listing registered
  projects.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

- `docs/spec-guidance.md`: replace the absolute-path example with a URL
  example; mark `repo:` as optional and document accepted forms.
- `docs/run-loop.md`: document the resolution order and the `--repo` flag.
- `README.md`: drop the absolute-path quickstart example; show the URL form
  and note that the field is optional.
