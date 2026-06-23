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
- Scope/ignores live in one `.markdownlint-cli2.jsonc` invoked with no glob
  args in the package.json script string — keeps scope under version control,
  not embedded in the command.
- `globs` use the recursive `**/*.md` form for every directory tree, not bare
  directory paths — markdownlint-cli2 hands globs to globby, where a bare
  directory (`v1/spec`) matches the directory entry, not its `.md` descendants,
  and silently matches zero files. Use `v1/spec/**/*.md`, `v1/docs/**/*.md`,
  `reports/**/*.md`; root docs as literal `README.md`, `AGENTS.md`.
- Root docs enumerated (`README.md`, `AGENTS.md`), not a root `*.md` glob —
  `CLAUDE.md` symlinks to `AGENTS.md`; a `*.md` glob would lint it twice.
- House-style tuning is bound to actual corpus output, not guessed: run the
  linter against the real trees, then triage the rules that actually fire —
  disable pervasive house-style ones, keep rules enforcing genuine conventions.
  Known-pervasive and to disable: `MD013` (line-length — long lines/tables/URLs)
  and `MD033` (no-inline-HTML — `<...>` tags across docs). Beyond these, do not
  pre-enumerate verdicts before the output exists; decide each from what fires.
- Script invoked via the explicit installed-binary path
  (`bun node_modules/markdownlint-cli2/...`), matching the existing biome
  scripts — not a bare binary name; also de-risks Bun resolution (ties to the
  Bun-compat path below).
- Out of scope by omission: `v2/**` is not globbed (intent scopes v1/spec,
  v1/docs, reports/, root docs only).
- Generated CSV-adjacent files need no `ignores` entry — markdownlint processes
  only `.md`, so the `**/*.md` globs never reach a `.csv`. Considered, no-op.
- Bun compatibility is verified, not assumed: if markdownlint-cli2 will not run
  cleanly under Bun, append `## Blocker` to the subspec and stop rather than
  guess or swap tools.

## Task checklist

- Add `markdownlint-cli2` as a devDependency; update `bun.lock`.
- Add `.markdownlint-cli2.jsonc`: `globs` `v1/spec/**/*.md`, `v1/docs/**/*.md`,
  `reports/**/*.md`, `README.md`, `AGENTS.md`; `ignores` `**/completed/**` and
  `**/node_modules/**`; `config` disabling MD013 + MD033 plus any other rules
  the real-corpus run shows are pervasive house style.
- Run the linter against the corpus and triage firing rules before finalizing
  `config`.
- Add `"lint:md": "bun node_modules/markdownlint-cli2/markdownlint-cli2.bin.mjs"`
  (the installed-binary path, matching the biome scripts) to package.json;
  confirm it runs under Bun.
- Document `bun run lint:md` and the config scope/exemptions in README
  `## Development`.

## Acceptance criteria

- [ ] `markdownlint-cli2` is a devDependency in `package.json` and `bun install`
      resolves it (`bun.lock` updated).
- [ ] `bun run lint:md` is defined, invokes markdownlint-cli2 via the explicit
      installed-binary path, and runs against the repo's `.markdownlint-cli2.jsonc`,
      executing to completion under Bun — a non-zero exit from current-corpus
      violations is acceptable; a crash or command-not-found is not.
- [ ] `bun run lint:md` processes a known-nonzero set of `.md` files across the
      scoped trees (its output names files from `v1/spec`, `v1/docs`, and
      `reports/`) — a zero-match config that exits 0 green fails this criterion.
- [ ] The config lints `v1/spec`, `v1/docs`, `reports/`, `README.md`, and
      `AGENTS.md` via recursive `**/*.md` globs, and ignores `**/completed/**`;
      `CLAUDE.md` is not linted twice.
- [ ] The config disables `MD013`, `MD033`, and any other rules the corpus run
      showed are pervasive house style, so `bun run lint:md` output reflects
      genuine deviations rather than blanket noise.
- [ ] README `## Development` documents `bun run lint:md` and points to the
      markdown house-style config and its scope/exemptions.

## Documentation updates

- README `## Development`: add `bun run lint:md` to the script list with its
  scope and `**/completed/**` exemption.
- `v2/docs/v1-behaviors.md`: not required — net-new dev tooling, no existing
  behavior changed.
