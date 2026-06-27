# Infer a project's stack from its root

The runbook seeds an "inferred stack" fact, but no stack inference exists today.
This subspec adds a pure, dependency-free helper that maps a project root to a
human-readable stack label by detecting committed marker files. Consumed by 01.

## Decisions

- Pure synchronous function over a root path; reads marker files only — no network, no git, no config. Rules out shelling out to package managers.
- Detect from a small, explicit marker→label set (e.g. Bun/TS lockfile+`package.json` → "TypeScript (Bun)", `Gemfile` → "Ruby", `go.mod` → "Go", `pyproject.toml`/`requirements.txt` → "Python", `Cargo.toml` → "Rust"). Rules out a heavy language-detection dependency.
- Unrecognized root returns an explicit unknown label, never throws. Rules out init failing on an exotic repo.
- Multiple markers resolve deterministically (documented precedence), not first-filesystem-order. Rules out flaky labels on polyglot repos.
- Returns a display string only, not structured metadata. Deferred to first consumer: any richer shape — pin when a second caller needs it.

## Task checklist

- [ ] Add the stack-inference helper under `v1/src`.
- [ ] Cover each detected ecosystem, the polyglot precedence case, and the unknown case with unit tests.

## Acceptance criteria

- [ ] A root containing a Bun/TypeScript manifest infers a TypeScript/Bun label.
- [ ] Roots for at least two other ecosystems (e.g. Ruby `Gemfile`, Go `go.mod`) each infer their respective label.
- [ ] A root with no recognized markers returns an explicit unknown label rather than throwing.
- [ ] A polyglot root (multiple markers) resolves to a single deterministic label per the documented precedence.
- [ ] Inference reads only the given root and requires neither network nor a git repo.

## Documentation updates

- Doc-comment the helper's contract (inputs, marker→label table, precedence, unknown case) per `v2/docs/documentation-standard.md`.
