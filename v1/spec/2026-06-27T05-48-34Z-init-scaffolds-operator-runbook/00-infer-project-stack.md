# Infer a project's stack from its root

The runbook seeds an "inferred stack" fact, but no stack inference exists today.
This subspec adds a pure, dependency-free helper that maps a project root to a
human-readable stack label by detecting committed marker files. Consumed by 01.

## Decisions

- Pure synchronous function over a root path; reads marker files only — no network, no git, no config. Rules out shelling out to package managers.
- Detect from this complete, fixed marker→label set (no examples — this is the full table): Rules out a heavy language-detection dependency.
  - `bun.lock`/`bun.lockb` + `package.json` → "TypeScript (Bun)"
  - `package.json` (no Bun lockfile) → "JavaScript/TypeScript (Node)"
  - `Gemfile` → "Ruby"
  - `go.mod` → "Go"
  - `pyproject.toml`/`requirements.txt` → "Python"
  - `Cargo.toml` → "Rust"
- Unrecognized root returns an explicit unknown label, never throws. Rules out init failing on an exotic repo.
- Multiple markers resolve deterministically by fixed priority order — first match in the table order above wins (Bun > Node > Ruby > Go > Python > Rust), not first-filesystem-order. Rules out flaky labels on polyglot repos.
- Returns a display string only, not structured metadata. Deferred to first consumer: any richer shape — pin when a second caller needs it.

## Task checklist

- [ ] Add the stack-inference helper under `v1/src`.
- [ ] Cover each detected ecosystem, the polyglot precedence case, and the unknown case with unit tests.

## Acceptance criteria

- [ ] A root containing a Bun/TypeScript manifest infers a TypeScript/Bun label.
- [ ] A Ruby root (`Gemfile`) infers "Ruby" and a Go root (`go.mod`) infers "Go".
- [ ] A root with no recognized markers returns an explicit unknown label rather than throwing.
- [ ] A polyglot root (e.g. `go.mod` + `Gemfile`) resolves to the higher-priority label per the fixed priority order (Bun > Node > Ruby > Go > Python > Rust).
- [ ] Inference reads only the given root and requires neither network nor a git repo.

## Documentation updates

- Doc-comment the helper's contract (inputs, marker→label table, precedence, unknown case) per `v2/docs/documentation-standard.md`.
