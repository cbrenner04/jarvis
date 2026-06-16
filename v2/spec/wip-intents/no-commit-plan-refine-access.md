# Preserve no-commit plan intents after refine failure

**Scope.** v1 harness work - `v1/**`, plan-mode docs, and tests. Lives in
`v2/spec/wip-intents/` for routing.

## Problem

For `commit: false`, fresh `jarvis1 plan` stores the plan artifact under
`~/.jarvis/specs/<project>/<name>/`. Intent drafting succeeds there, but the
refine phase launches the agent from the target repository cwd. Claude Code then
cannot read or write the external `intent.md`, because the file is outside the
agent's writable workspace.

When refine fails, Jarvis records `agent-error` and calls the no-commit cleanup
path. By then the temp spec directory has already been renamed to the final
intent name, so cleanup deletes the successfully drafted intent too.

That loses the only durable artifact the operator expected to inspect or retry.

## Desired behavior

- For `commit: false`, every plan phase that edits the external spec artifact
  must run with access to that artifact.
- Refine can append `## Refinement`, `## Refine skip`, or `## Blocker` to the
  external `intent.md` without sandbox/write-boundary failures.
- After a no-commit intent is named and written, Jarvis prints the external
  `intent.md` path so the operator can find the artifact even if a later phase
  fails.
- If intent drafting succeeds but a later phase fails, Jarvis preserves the
  external spec directory and prints its path in the failure summary.
- Cleanup removes only abandoned pre-intent temp directories, not a finalized
  named spec directory.
- The behavior remains unchanged for committed/in-repo plan specs.

## Decisions

- Treat a successfully named external spec directory as an operator-owned
  artifact, even if the full plan pipeline fails later.
- Do not make `commit: false` silently fall back to in-repo specs.
- Prefer fixing the agent cwd/access contract over teaching refine to shell-copy
  content through the target repository.

## Acceptance signals

- A regression test covers `commit: false` refine success against an external
  spec path.
- A regression test covers `commit: false` refine failure after intent drafting:
  the named external spec directory and `intent.md` remain on disk.
- Existing intent-draft failure cleanup still removes abandoned `tmp-*`
  external spec directories.
- Output includes the external `intent.md` path after no-commit intent drafting
  succeeds, and failure output includes the preserved external spec path when
  cleanup is skipped.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` to say no-commit specs are preserved external
  artifacts after intent drafting succeeds, including on later phase failure.
- Update any plan-mode troubleshooting text that describes where to find a
  failed no-commit spec.

## Out of scope

- Changing the default `commit` setting.
- Reworking v2 `jarvis intent` / ready-intent flow.
- Broad sandbox policy changes for every agent mode.
