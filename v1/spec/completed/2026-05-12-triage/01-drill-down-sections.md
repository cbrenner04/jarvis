# 01 - Drill-down sections (git, spec, PR, session log)

## Problem

Subspec 00 lands `jarvis triage <name>` with empty section stubs. This
subspec fills them. Each section reads from one source, formats a small
block of text, and degrades gracefully when its source is unavailable —
no section's failure aborts the report.

## Decisions

Section-by-section:

### Identity

- Worktree absolute path.
- Branch name (`git rev-parse --abbrev-ref HEAD`).
- Spec path (from the in-worktree active spec marker established by
  `worktree-local-spec-path`; if absent, print `(unknown — pre-marker worktree)`).
- Active subspec (from `getActiveLinkedSubspecPath` when the spec is an
  index; otherwise `n/a`).
- Run namespace, reconstructed as `${project.key}:${specDisplayName}`
  using the same `getSpecDisplayName` helper `run.ts` calls. When the
  spec is unknown, namespace is `(unknown)`.

### Git

- Porcelain output verbatim, indented two spaces. If empty, print
  `(clean working tree)`.
- Ahead/behind vs upstream: `git rev-list --left-right --count @{u}...HEAD`.
  If no upstream, print `(no upstream)`.
- Unpushed commits: `git log @{u}.. --pretty='%h %s'`. If no upstream
  or zero commits, omit.
- Last commit: `git log -1 --pretty='%h %s (%ar)'`.

### Spec

- `countUnchecked(specPath)` → `X/Y tasks unchecked` (or "complete").
- `getFirstUncheckedTask(specPath)` → first unchecked task text, or
  omit if complete.
- For an index spec with an active subspec: snapshot acceptance
  criteria with `snapshotAcceptanceCriteria(activeSubspecPath)` and
  print unmet ones. If the active subspec marker is absent or the
  spec is not an index, omit.
- If the spec path is unknown, the whole section prints
  `(spec unavailable — pre-marker worktree)`.

### PR

- `gh pr view <branch> --json state,url,isDraft,updatedAt,title`.
- Print state (`OPEN`/`DRAFT`/`MERGED`/`CLOSED`), URL, last updated
  relative time, title.
- If `gh pr view` exits non-zero (no PR for branch), print `(no PR)`.
- If `gh` is not on PATH or not authenticated, print `(gh unavailable: <short reason>)` — do not abort.

### Session log

- Compute namespace as in Identity. If unknown, skip with
  `(namespace unknown — cannot locate session log)`.
- Glob `resolveSessionsDir(opts)/<namespace>-*.log`. Take the most
  recent by mtime.
- Print the absolute path of that file.
- Print the last 40 lines, indented two spaces. If the file is shorter
  than 40 lines, print all of it. If no log files match the
  namespace, print `(no session logs found for namespace)`.
- Filenames contain `:` from the namespace; glob must match literally.
  Use `readdirSync` + `startsWith(namespace + "-")` and `endsWith(".log")`
  rather than a shell glob to avoid quoting issues.

## Implementation hints

- Each section is a pure function `(ctx) => string` where `ctx` carries
  the worktree path, project, resolved spec path (or undefined),
  namespace (or undefined), and config opts. The top-level command
  composes them in order.
- Wrap each section call in a try/catch that converts thrown errors into
  a single-line `(error: <message>)` inside the section body. Other
  sections continue to run.
- Reuse the existing helpers (`countUnchecked`, `getFirstUncheckedTask`,
  `getActiveLinkedSubspecPath`, `snapshotAcceptanceCriteria`,
  `getSpecDisplayName`, `resolveSessionsDir`) — do not duplicate logic.
- `gh pr view` should be invoked through the same wrapper `run.ts` /
  `cleanup.ts` already use, so authentication and PATH errors surface
  consistently.

## Task Checklist

- [x] Implement Identity section reader + formatter.
- [x] Implement Git section reader + formatter.
- [x] Implement Spec section reader + formatter, including the
  index-spec acceptance-criteria branch.
- [x] Implement PR section reader + formatter with graceful
  `(no PR)` / `(gh unavailable)` handling.
- [x] Implement Session log section reader + formatter (40-line tail,
  namespace-prefix match, mtime selection).
- [x] Per-section try/catch so one failing section does not abort the
  report.
- [x] Tests covering: clean worktree, dirty worktree with untracked
  files only, dirty with modified working tree, no upstream branch,
  unpushed commits, missing spec marker (degraded spec section).

## Acceptance criteria

- [x] Each section's content matches the format spelled out under
  Decisions for both "happy" and "missing source" cases.
- [x] A failure in one section is reported inline as `(error: ...)` and
  does not prevent other sections from rendering.
- [x] Tests cover every degradation path listed above.
- [x] No source files outside the worktree are read except the
  session log under `resolveSessionsDir`.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- `docs/worktrees-and-commits.md`: append the section format reference
  (what each section shows and where its data comes from) so users
  understand the report without reading the source.
