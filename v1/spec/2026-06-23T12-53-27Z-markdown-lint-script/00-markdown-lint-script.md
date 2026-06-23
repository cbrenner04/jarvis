# markdownlint-cli2 config + `lint:md` script

## Problem

Markdown (specs, seeds, reports, docs) has no lint tool; prose conventions
drift per-author with only review to catch them. Add a Bun-runnable linter,
a config tuned to house style, and a `bun run lint:md` script. Config + script
only: no corpus reflow, no `ready` wiring. Reporting violations on the current
un-normalized corpus is acceptable.

## Decisions

- Tool: `markdownlint-cli2`, not `prettier --parser markdown` — rules-based and
  non-mutating; prettier reflows prose and would force corpus reflow (out of
  scope) and fight `v1/docs/spec-guidance.md` line conventions.
- Mode: lint-only, non-mutating; no `format:md`/autofix script. Deferred to
  first consumer: autofix — pin when a caller needs it.
- Scope/ignores live in one `.markdownlint-cli2.jsonc` invoked by a bare
  `markdownlint-cli2`; no glob args in the package.json script string — keeps
  scope under version control, not embedded in the command.
- Root docs enumerated (`README.md`, `AGENTS.md`), not a root `*.md` glob —
  `CLAUDE.md` symlinks to `AGENTS.md`; a `*.md` glob would lint it twice.
- Disable `MD013` (line-length) and `MD033` (no-inline-HTML) — both are
  pervasive house style (long lines/tables/URLs; `<...>` tags across docs);
  leaving them on buries genuine deviations in blanket noise. Keep rules that
  enforce real conventions (fenced-code language, ATX headings, list syntax).
- Out of scope by omission: `v2/**` is not globbed (intent scopes v1/spec,
  v1/docs, reports/, root docs only).

## Task checklist

- Add `markdownlint-cli2` as a devDependency; update `bun.lock`.
- Add `.markdownlint-cli2.jsonc`: `globs` for v1/spec, v1/docs, reports/,
  README.md, AGENTS.md; `ignores` for `**/completed/**` and `**/node_modules/**`;
  `config` disabling MD013 + MD033, tuned against the rest of house style.
- Add `"lint:md": "markdownlint-cli2"` (or the installed binary path, matching
  the existing biome scripts) to package.json; confirm it runs under Bun.
- Document `bun run lint:md` and the config scope/exemptions in README
  `## Development`.

## Acceptance criteria

- [ ] `markdownlint-cli2` is a devDependency in `package.json` and `bun install`
      resolves it (`bun.lock` updated).
- [ ] `bun run lint:md` is defined and runs markdownlint-cli2 against the repo's
      `.markdownlint-cli2.jsonc`, executing to completion under Bun — a non-zero
      exit from current-corpus violations is acceptable; a crash or
      command-not-found is not.
- [ ] The config lints `v1/spec`, `v1/docs`, `reports/`, `README.md`, and
      `AGENTS.md`, and ignores `**/completed/**`; `CLAUDE.md` is not linted twice.
- [ ] The config disables `MD013` and `MD033`, so `bun run lint:md` output
      reflects genuine deviations rather than blanket line-length/inline-HTML
      noise.
- [ ] README `## Development` documents `bun run lint:md` and points to the
      markdown house-style config and its scope/exemptions.

## Documentation updates

- README `## Development`: add `bun run lint:md` to the script list with its
  scope and `**/completed/**` exemption.
- `v2/docs/v1-behaviors.md`: not required — net-new dev tooling, no existing
  behavior changed.
