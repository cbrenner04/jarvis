# Operator documentation for the shared-runtime move

## Problem

Operator and agent guidance still describe `shared/` as a separate package, document the `shared/**` must-not-import-`v2/**` boundary, and cite `shared/...` module paths across `v2/docs/**` and root `AGENTS.md`. After the relocation subspec, docs must describe `v2/src/shared/` as the shared runtime home and record the move in the behavior catalog.

## Decision ledger

- Replace path citations `shared/` → `v2/src/shared/` in operator-facing docs where they denote module locations; rules out leaving stale top-level `shared/` paths that no longer exist on disk.
- `v2/docs/shared-invocation.md` and `v2/docs/shared-step-runner.md` keep their filenames; update in-doc path references only unless a rename is required for accuracy — rules out gratuitous doc file renames in this change.
- Record the relocation in `v2/docs/v1-behaviors.md` as a behavior-visible layout change (former `shared/` modules now live under `v2/src/shared/`; digest and CI discovery follow the code move).

## Tasks

- [ ] Update `AGENTS.md`: remove `shared/` from the repo layout bullet list; remove the `shared/**` must-not-import-`v2/**` rule; state that shared runtime modules live under `v2/src/shared/`; adjust test-scope bullets that still name a separate `shared/` surface only where this spec's code change still exposes `test:shared` (point at `v2/src/shared/` as the tree those slices include).
- [ ] Update `v2/docs/v2-architecture.md` import matrix and git/github ownership sections that cite `shared/` paths.
- [ ] Update `v2/docs/shared-invocation.md`, `v2/docs/operator-runbook.md`, `v2/docs/coding-standards.md`, `v2/docs/test-writing.md`, and other `v2/docs/**` files that still cite `shared/` module paths (search `shared/` under `v2/docs/`).
- [ ] Add or adjust a `v2/docs/v1-behaviors.md` catalog entry for the shared-runtime relocation.

## Acceptance criteria

- [ ] `AGENTS.md` does not list a top-level `shared/` package or the `shared/**`-must-not-import-`v2/**` boundary; it names `v2/src/shared/` as the shared runtime location.
- [ ] `grep -r 'shared/' v2/docs --include='*.md'` has no remaining module-path citations that omit the `v2/src/shared/` prefix where they refer to relocated sources (fixture-only or historical prose excepted when clearly about retired layout).
- [ ] `v2/docs/v1-behaviors.md` documents that shared runtime modules moved from `shared/` to `v2/src/shared/` and that the executable-tree digest no longer lists a top-level `shared` pathspec.
- [ ] `bun run typecheck` passes (docs-only subspec; no additional test gate).

## Documentation updates

- `AGENTS.md` — layout and import-boundary bullets per tasks.
- `v2/docs/**` — path references per tasks; `v2/docs/v1-behaviors.md` — relocation catalog entry.
