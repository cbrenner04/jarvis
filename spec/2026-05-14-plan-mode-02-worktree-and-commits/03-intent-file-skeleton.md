# 03 — Seed `intent.md` from file or inline input

## Problem

Once the worktree exists and `<name>` is chosen, plan mode writes
`spec/<name>/intent.md` into the worktree as the first artifact. This
file is the source of truth for "what the user wants this spec to
become." It will be read by every later phase (draft, self-review,
resume).

## Decisions

- **Path:** `<worktree>/spec/<name>/intent.md` where `<worktree>` is
  `<projectRoot>/.worktree/plan-<name>/`.
- **Contents by mode:**
  - **File mode:** byte-for-byte copy of the intent file. No leading
    `# Intent` heading is added; whatever the file contains is what
    lands. Trailing newline is preserved as in the source.
  - **Inline mode:** the inline text followed by exactly one trailing
    newline. No heading prepended.
  - **Interactive mode:** this subspec does **not** apply (interactive
    still hits the stub).
- **Parent directory creation.** `spec/<name>/` is created as needed
  (`mkdir -p` semantics).
- **Encoding.** UTF-8. Source intent files are read as UTF-8; if the
  read fails, surface the error and exit `1` without committing
  anything (subspec 01's worktree is left in place; cleanup is the
  user's concern via `jarvis cleanup` / `jarvis triage`).
- **No git operations in this subspec.** The commit that captures
  `intent.md` lands in subspec 04 as the `plan: interview` commit.
  This subspec only writes the file into the worktree.
- **Idempotence.** If `spec/<name>/intent.md` already exists in the
  worktree (it should not, since the worktree was just created), refuse
  to overwrite: exit `1` with a message naming the path. This protects
  against accidental re-runs hitting an unexpected state.
- **No agent calls.**

## Implementation hints

- A small helper in `src/commands/plan.ts` (or a sibling module if
  `plan.ts` is getting large): `seedIntentFile({ worktreePath, name,
  mode, intentPath?, intentText? }): void`.
- Use Node's `node:fs` synchronous APIs (`readFileSync`,
  `writeFileSync`, `mkdirSync({ recursive: true })`) — that is what
  the rest of the codebase uses (see `src/worktree-lock.ts`,
  `src/worktree.ts`). Do not introduce `Bun.file`/`Bun.write` or
  `fs/promises` here.

## Tasks

- [x] Implement `seedIntentFile` with the behavior above.
- [x] Wire it into `planCommand` after worktree creation.
- [x] Tests:
  - File mode: source file copied byte-for-byte to `spec/<name>/intent.md`.
  - Inline mode: text written with exactly one trailing newline.
  - Existing `intent.md` in the worktree → exit `1`.
  - Source intent file unreadable → exit `1`, no `intent.md` written.

## Acceptance criteria

- [x] After `planCommand` returns, the worktree contains
  `spec/<name>/intent.md` with the documented contents for file and
  inline modes.
- [x] Interactive mode is unaffected (still hits the skeleton stub).
- [x] No git commit, push, or PR action occurs in this subspec.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
