# 00 - Resolve compact-timestamp plan specs

## Problem

`jarvis1 triage <target> --merge` already resolves a `plan/*` worktree in the registered project's Jarvis-owned v2 home (`~/.jarvis/worktrees/<key>/plan/<name>`), and already skips the completeness gate for plan branches. It still refuses with `no spec found for branch plan/<name>`.

Root cause: v2 plan worktrees carry no `.active-spec-path` marker (only v1 patch preflight writes it, `v1/src/modes/patch/preflight.ts:593`), so lookup falls to `deriveSpecPathFromBranch` (`v1/src/commands/triage.ts:1185`). Its plan-branch scan matches spec dirs via `stripPlanSpecTimestampPrefix` (`v1/src/modes/plan/spec-paths.ts:14`), whose regex accepts only the v1 dashed timestamp `2026-07-16T21-57-24Z-<name>`. v2 writes compact dirs `20260716T215724Z-<name>` (`v2/src/execution/publication-workflow-steps.ts:505`). The prefix comes back unstripped, the `=== specName` filter never holds, and both the primary-checkout scan and the worktree fallback miss.

## Decisions

- Broaden `stripPlanSpecTimestampPrefix` to accept the compact form alongside the dashed form; rules out a v2-only branch inside triage, which would drift from the shared helper.
- Accept that the broadened helper also reaches `cleanup.ts` and `modes/plan/run.ts`; those call sites strip the same dir vocabulary, so compact-aware matching there is correct, not incidental.
- Leave the plan-branch completeness skip (`triage.ts:1696`) untouched; rules out tightening acceptance checks while fixing lookup.
- Keep the strip helper the only runtime change; the two-home worktree resolution and both gates already work and rule out touching `resolve-merge-target.ts`.

## Acceptance criteria

- [x] `jarvis1 triage <target> --merge` on a `plan/*` branch whose spec directory uses the compact v2 timestamp (`20260716T215724Z-<name>`) and exists only in the v2-home worktree resolves that spec and proceeds to the gates instead of refusing `no spec found for branch`.
- [x] A test in `v1/test/triage-command.test.ts` drives `--merge` against a markerless `plan/<name>` worktree in the registered project's Jarvis-owned home, with the spec dir compact-timestamped under `v2/spec` in the worktree only; it fails against the pre-fix code with the `no spec found` refusal and passes after.
- [x] `stripPlanSpecTimestampPrefix` returns `<name>` for both `2026-07-16T21-57-24Z-<name>` and `20260716T215724Z-<name>`, and returns untimestamped basenames unchanged; a unit test covers all three and fails against the pre-fix code.
- [x] The existing plan-PR unchecked-acceptance-criteria merge test (`v1/test/triage-command.test.ts:3265`) stays green (completeness semantics unchanged).
- [x] `v1/test/triage-command.test.ts` `describe("merge target resolution")` stays green (two-home resolution unchanged by this fix).

## Documentation updates

- `v1/docs/operator-runbook.md` Merging: record that `--merge` finds plan specs in the registered project's Jarvis-owned home; remove the plan hand-merge workaround.
- `v2/docs/operator-runbook.md`: drop plan PRs from the v2 merge gotcha; delete the gotcha if no unsupported shape remains.
- `v2/docs/v1-behaviors.md`: record v2-home plan-spec resolution, including compact-timestamp spec dirs.
