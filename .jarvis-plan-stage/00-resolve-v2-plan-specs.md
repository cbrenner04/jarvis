# Resolve v2 plan specs for gated merge

## Problem

`jarvis1 triage <target> --merge` can resolve a `plan/*` worktree in the registered project's Jarvis-owned home, but refuses when its plan spec exists only under that worktree's `v2/spec` tree. Operators must bypass the gated merge path.

## Decisions

- Use the merge target's existing repository/Jarvis-owned home resolution for plan-spec lookup; rules out a separate v2-only worktree resolver that can drift.
- Keep `plan/*` PRs exempt from spec-completeness rejection during `--merge`; rules out requiring authored plan acceptance criteria to be checked before the spec PR lands.

## Implementation

- Resolve a markerless `plan/*` spec from `v2/spec` inside the selected registered-project worktree when the primary checkout has no matching spec.
- Add focused regression coverage for the registered-project home, v2 spec location, gates, and unchecked plan criteria.
- Align the durable operator and parity documentation.

## Acceptance criteria

- [ ] Given a `plan/*` target in the registered project's Jarvis-owned worktree home whose timestamped spec exists only under that worktree's `v2/spec`, `jarvis1 triage <target> --merge` finds the spec, runs the local-ready and CI-green gates, and merges.
- [ ] The same gated merge remains eligible when the located plan spec has unchecked non-human-only acceptance criteria.
- [ ] A regression test in `v1/test/triage-command.test.ts` covers this registered-home v2 plan-worktree case and fails against the pre-fix code.
- [ ] `v1/docs/operator-runbook.md` documents v2-home plan-spec lookup in Merging without a plan hand-merge workaround; `v2/docs/operator-runbook.md` no longer lists supported plan PRs in the v2 merge gotcha; `v2/docs/v1-behaviors.md` records the resolved behavior.

## Documentation updates

- `v1/docs/operator-runbook.md` — update Merging lookup behavior and remove the workaround.
- `v2/docs/operator-runbook.md` — remove the fixed plan-PR gotcha, deleting the gotcha if no unsupported shape remains.
- `v2/docs/v1-behaviors.md` — record registered-home v2 plan-spec resolution and preserved plan completeness semantics.
