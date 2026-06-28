# Derive missing finalize spec path

## Problem

`jarvis1 triage <worktree> --mark-ready` and resolved `--merge` targets share finalization, but that path refuses old/completed worktrees that lack `.active-spec-path`.

## Decisions

- Prefer `.active-spec-path` over branch-derived spec lookup; rules out silently changing marker-bearing worktrees.
- Derive only when the marker is absent; rules out bypassing unreadable, empty, or invalid marker state.
- Resolve markerless finalization from branch name to an on-disk spec file before completeness checks; rules out running gates from a directory guess.
- Search `plan.targetDir`, then `v1/spec`, then `v2/spec`; within each home prefer direct branch match before timestamp-stripped `plan/` match, rules out a new triage-only mapping order.

## Tasks

- [ ] Add markerless branch-to-spec derivation to the shared finalization resolver used by `--mark-ready` and resolved `--merge` targets.
- [ ] Keep marker-present behavior unchanged.
- [ ] Refuse unresolvable markerless branches before commit, PR, gate, ready, CI, or merge side effects.
- [ ] Refuse matched spec directories without `index.md` unless they contain exactly one markdown spec file.
- [ ] Cover patch branch, `plan/` timestamped directory, resolved `--merge` target, configured `plan.targetDir`, fallback homes, index-directory, single-file, and ambiguous-directory cases.
- [ ] Update durable docs in the required homes.

## Acceptance criteria

- [x] `jarvis1 triage <worktree> --mark-ready` finalizes a complete markerless patch worktree when its branch maps to an on-disk spec.
- [x] `jarvis1 triage <target> --merge` runs the gated merge path for a complete markerless worktree after `<target>` resolves and its branch maps to an on-disk spec.
- [x] Marker-present `--mark-ready` and `--merge` continue to use the marker path, including unreadable, empty, or invalid marker failures, even when branch-derived lookup would find a spec.
- [x] Markerless `plan/<name>` worktrees resolve timestamped spec directories whose timestamp prefix strips to `<name>`.
- [x] Markerless lookup searches `plan.targetDir`, then `v1/spec`, then `v2/spec`, and prefers a direct branch match before a timestamp-stripped `plan/` match inside each home.
- [x] A matched spec directory resolves to `index.md` when present; otherwise a directory with exactly one markdown spec file resolves to that file.
- [x] A matched spec directory without `index.md` refuses when it contains zero markdown spec files or multiple markdown spec files.
- [x] A markerless branch with no matching on-disk spec refuses with a clear error before any finalize or merge side effect.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

- [x] Update `v2/docs/v1-behaviors.md` so `triage --mark-ready` and `triage --merge` record markerless branch-derived spec resolution.
- [x] Update `v1/docs/operator-runbook.md` Merging so `triage --merge` is the universal gated merge path with no marker caveat.
