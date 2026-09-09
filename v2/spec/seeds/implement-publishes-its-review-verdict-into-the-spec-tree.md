---
name: implement-publishes-its-review-verdict-into-the-spec-tree
---

# Implement commits `verdict-patch.md` into the spec tree it publishes

## Problem

`excludeVerdictFromStaging` (`v2/src/execution/review-intent-enforcement.ts:290`) exists for exactly one purpose, stated in its own doc comment:

> Called before every landing (intent-stage and plan-tree alike) to remove the verdict file from staging, **so no landing kind ever publishes it as durable output.**

Implement is the landing kind that does. Its verdict path is built as

```ts
const verdictPath = join(dirname(launchSpecPath), "verdict-patch.md");   // implement-workflow-steps.ts:675-678
```

— that is, **inside the spec tree directory** (`v2/spec/<timestamp>-<name>/verdict-patch.md`), not inside a staging directory. Implement lands through the ordinary completion commit (`git add -A` over the worktree), which never calls `excludeVerdictFromStaging`; the only caller is the resume path (`workflow-runner-resume.ts:266`). `verdict-*.md` is also absent from `.gitignore`, so nothing else stops it.

The result: every reviewed implement publishes its review verdict as spec content, and it is then archived to `completed/` with the spec.

## Evidence (recurrence, not a one-off)

- `#3578` landed `v2/spec/20260907T171551Z-bound-diff-derived-mutant-execution/verdict-patch.md` onto `main`; removed by hand in `#3609`.
- The 2026-09-08 `stamp-gate-commands-on-gate-running-steps` implement published another (`+8` lines) into its PR; stripped by hand before merge.

`bun run lint:md` does not catch it — the shared ignores exclude `**/verdict-*.md` — so the gate is green either way. The runbook already tells operators to strip `verdict-*.md` when hand-publishing, which is the manual workaround this seed replaces.

## Decisions

- The implement review verdict is written outside the published spec tree — a harness sidecar path (`.jarvis-*`) like every other review artifact; rules out writing harness state into a directory whose entire contents are committed and archived.
- If the verdict must remain adjacent to the spec for prompt or recovery reasons, the completion commit excludes it explicitly through the same shared helper every other landing kind uses; rules out a second, implement-only exclusion rule that can drift from `excludeVerdictFromStaging`.
- `verdict-*.md` is gitignored as a defense in depth, so a future landing path cannot reintroduce this silently; rules out relying solely on call-site discipline.
- Existing resume-path exclusion behavior is unchanged, pinned; rules out changing intent/plan landing while fixing implement.
- Archival is not the seam to fix — a verdict must never be committed in the first place; rules out teaching `cleanup` to strip verdicts during archival.

## Acceptance criteria

- [ ] A test proves a completed reviewed implement's published tree contains no `verdict-*.md`; it fails against the current completion commit reachable on `main`.
- [ ] A test proves the implement review verdict is still written and readable at its resolved path during review, so the fix does not break verdict-dependent actuator retry.
- [ ] A test proves the resume path's existing verdict exclusion is unchanged.
- [ ] `verdict-*.md` is gitignored, and a test or guard proves a verdict file in a worktree is not staged by the completion commit.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the review verdict is harness state, never published spec content; name its resolved path.
- `v2/docs/operator-runbook.md` — drop the hand-publish instruction to strip `verdict-*.md`, and the note in the multi-subspec publication gotcha.
- `v2/docs/v1-behaviors.md` — record that implement no longer publishes its verdict.
