# Derive missing finalize spec path

## Problem

`jarvis1 triage <worktree> --mark-ready` and resolved `--merge` targets share named-worktree finalization, but that path refuses old/completed worktrees that lack `.active-spec-path`.

## Decisions

- Prefer `.active-spec-path` over branch-derived spec lookup; rules out silently changing marker-bearing worktrees.
- Derive only when the marker is absent; rules out backfilling or rewriting `.active-spec-path`.
- Resolve markerless finalization from branch name to an on-disk spec file before completeness checks; rules out running gates from a directory guess.
- Use cleanup/archive branch mapping homes (`plan.targetDir`, `v1/spec`, `v2/spec`) for fallback lookup; rules out a new triage-only mapping table.

## Tasks

- [ ] Add markerless branch-to-spec derivation to the shared named-worktree resolver used by `--mark-ready` and `--merge`.
- [ ] Keep marker-present behavior unchanged.
- [ ] Refuse unresolvable markerless branches before commit, PR, gate, ready, CI, or merge side effects.
- [ ] Cover patch branch, `plan/` timestamped directory, configured `plan.targetDir`, fallback homes, index-directory, and single-file cases.
- [ ] Update durable docs in the required homes.

## Acceptance criteria

- [ ] `jarvis1 triage <worktree> --mark-ready` finalizes a complete markerless patch worktree when its branch maps to an on-disk spec.
- [ ] `jarvis1 triage <worktree> --merge` runs the gated merge path for a complete markerless patch worktree when its branch maps to an on-disk spec.
- [ ] Marker-present `--mark-ready` and `--merge` continue to use the marker path even when branch-derived lookup would find a different spec.
- [ ] Markerless `plan/<name>` worktrees resolve timestamped spec directories whose timestamp prefix strips to `<name>`.
- [ ] Markerless lookup searches the configured `plan.targetDir` before `v1/spec` and `v2/spec` fallbacks.
- [ ] A matched spec directory resolves to `index.md` when present; otherwise a directory with exactly one markdown spec file resolves to that file.
- [ ] A markerless branch with no matching on-disk spec refuses with a clear error before any finalize or merge side effect.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- [ ] Update `v2/docs/v1-behaviors.md` so `triage --mark-ready` and `triage --merge` record markerless branch-derived spec resolution.
- [ ] Update `v1/docs/operator-runbook.md` Merging so `triage --merge` is the universal gated merge path with no marker caveat.
