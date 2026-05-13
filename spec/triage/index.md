# `jarvis triage` — read-only inspection for dirty worktrees

repo: git@github.com:cbrenner04/jarvis.git

When `jarvis run` short-circuits because the worktree is not clean (see
`worktreeCompletionBlocker` in `src/worktree.ts`), the user is left with a
worktree on disk whose state they have to reconstruct by hand: branch name,
unpushed commits, PR status, spec progress, what the agent was doing right
before it bailed. The information jarvis needs to answer those questions
already exists — porcelain output, `gh pr view`, `countUnchecked`,
acceptance-criteria snapshots, and the per-namespace session log under
`resolveSessionsDir(...)/<namespace>-<timestamp>.log`. It is just scattered.

`jarvis triage` collects it into one command.

## Decisions

- **Read-only.** Triage inspects and reports. It does not commit, stash,
  push, or remove anything. Suggested next moves are printed as
  copy-pasteable shell commands; the user runs them. We considered an
  action-offering variant (`--commit-wip`, interactive `[y/N]` prompts)
  and rejected it as the same failure shape as auto-recovery: trading a
  known-uncomfortable state for an unknown one. The option can be
  reintroduced behind explicit flags later if the read-only version
  proves insufficient.
- **Two invocations:**
  - `jarvis triage` (no arg) lists every directory under `<projectRoot>/.worktree/`
    with a one-line summary: dirty?, ahead/behind, PR state, spec
    progress ratio. This is the entry point when the user has come back
    to a stale tree and forgotten the branch name.
  - `jarvis triage <worktree-name>` prints the full drill-down for one
    worktree.
- **Sources of truth, all already in-tree:**
  - Git state: `git status --porcelain`, `git log @{u}..`, `git rev-list --left-right --count @{u}...HEAD`, `git log -1 --pretty=…` in the worktree.
  - Spec: `countUnchecked`, `getFirstUncheckedTask` from `src/subspec.ts`; `getActiveLinkedSubspecPath` from the same; `snapshotAcceptanceCriteria` for the active subspec.
  - PR: `gh pr view <branch> --json state,url,isDraft,updatedAt` — degrade gracefully when no PR exists.
  - Session log: glob `<sessionsDir>/<namespace>-*.log`, pick the most
    recent by mtime, tail the last 40 lines. Namespace is reconstructed
    as `${project.key}:${specDisplayName}` exactly as `run.ts` builds
    it; print the namespace and the full log path so the user can grep
    further.
- **Worktree → spec resolution.** A worktree directory by itself does not
  remember which spec invoked it. The mapping is reconstructed by reading
  the spec path stored alongside the worktree. `prepareActiveSpecPath` /
  `worktree-local-spec-path` already establish that the active spec is
  written into the worktree; triage reads it from there. If the marker
  file is missing (older worktrees), triage degrades: it shows git + PR +
  session-log sections and notes that spec progress is unavailable.
- **Suggested next moves are rule-based, not LLM-driven.** A small table
  keyed on (dirty kind, unpushed?, PR state) emits 2–4 lines. Examples:
  - dirty = "only untracked spec files" → `git -C <path> add <files> && git -C <path> commit -m "seed spec"`
  - dirty = clean, unpushed > 0 → `git -C <path> push`
  - dirty = modified working tree, PR state = MERGED → "PR is merged; the work in this tree is probably orphaned. Inspect: `git -C <path> diff`. Discard: `git -C <path> stash && jarvis cleanup`."
  - dirty = modified working tree, no PR → "Inspect: `git -C <path> diff`. Commit: `git -C <path> add -A && git -C <path> commit`. Discard: `git -C <path> reset --hard && git -C <path> clean -fd`."
  Suggestions are advisory text; nothing is executed.
- **Loop-closer at the bail site.** `worktreeCompletionBlocker`'s callers
  (the spec-complete path in `commands/run.ts` and the iteration-edited-no-checks
  path) append a final line: `Run \`jarvis triage <worktree-name>\` to inspect.`
  The blocker function itself is unchanged; only the strings around its
  return value grow.
- **Exit code.** Always `0` on a successful inspection, even when the
  worktree is dirty — triage is informational. Non-zero only on usage
  errors (unknown worktree name, project resolution failure).
- **Scope cuts:**
  - No JSON output. Human-readable text only. A `--json` flag can be
    added later if scripting needs emerge.
  - No `triage --all-projects`. Triage runs against the current resolved
    project, same as `run` and `cleanup`.
  - No new persistence. Triage reads existing artifacts; it does not
    write a triage report file.
  - Session-log tail length is fixed at 40 lines. No `--tail N` flag in
    the first cut.

## Subspecs

- [x] [00 - `jarvis triage` command + CLI wiring](./00-triage-command.md)
- [x] [01 - Drill-down sections (git, spec, PR, session log)](./01-drill-down-sections.md)
- [x] [02 - Rule-based suggested-next-moves table](./02-suggested-moves.md)
- [x] [03 - Point bail messages at `jarvis triage`](./03-bail-message-loop-closer.md)
